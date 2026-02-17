"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Message } from "primereact/message";
import { ApiClientError, apiRequest } from "@/lib/api";

type AuthorRef = {
  id: string;
  name: string;
};

type RelatedWork = {
  work_key: string;
  title: string;
  cover_url: string | null;
  first_publish_year?: number | null;
  author_names?: string[];
};

type AuthorProfile = {
  id: string;
  name: string;
  bio: string | null;
  photo_url: string | null;
  works: Array<{
    work_key: string;
    title: string;
    cover_url: string | null;
  }>;
};

function relatedAuthorLabel(item: RelatedWork): string {
  if (!item.author_names?.length) return "Unknown author";
  const firstEntry = item.author_names[0]?.trim();
  if (!firstEntry) return "Unknown author";
  return firstEntry.split(",")[0]?.split(";")[0]?.trim() || "Unknown author";
}

export function BookDiscoverySection({
  supabase,
  workId,
  authors,
}: {
  supabase: SupabaseClient;
  workId: string;
  authors: AuthorRef[];
}) {
  const router = useRouter();
  const [relatedBooks, setRelatedBooks] = useState<RelatedWork[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [authorProfiles, setAuthorProfiles] = useState<AuthorProfile[]>([]);
  const [authorLoading, setAuthorLoading] = useState(false);
  const [error, setError] = useState("");

  const visibleRelatedBooks = useMemo(
    () => relatedBooks.filter((item) => Boolean(item.cover_url)),
    [relatedBooks],
  );
  const authorProfilesWithCoverWorks = useMemo(
    () =>
      authorProfiles
        .map((author) => ({
          ...author,
          works: author.works.filter((work) => Boolean(work.cover_url)),
        }))
        .filter((author) => author.works.length),
    [authorProfiles],
  );

  useEffect(() => {
    let active = true;
    const load = async () => {
      setRelatedLoading(true);
      setError("");
      try {
        const payload = await apiRequest<{ items: RelatedWork[] }>(
          supabase,
          `/api/v1/works/${workId}/related`,
        );
        if (active) setRelatedBooks(payload.items ?? []);
      } catch {
        if (active) setRelatedBooks([]);
      } finally {
        if (active) setRelatedLoading(false);
      }

      if (!authors.length) {
        if (active) setAuthorProfiles([]);
        return;
      }

      setAuthorLoading(true);
      try {
        const profiles = await Promise.all(
          authors.slice(0, 3).map(async (author) => {
            try {
              return await apiRequest<AuthorProfile>(
                supabase,
                `/api/v1/authors/${author.id}`,
              );
            } catch (err) {
              if (err instanceof ApiClientError && err.status === 404)
                return null;
              return null;
            }
          }),
        );
        if (active) {
          setAuthorProfiles(
            profiles.filter(
              (profile): profile is AuthorProfile => profile !== null,
            ),
          );
        }
      } catch {
        if (active) setAuthorProfiles([]);
      } finally {
        if (active) setAuthorLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [authors, supabase, workId]);

  const importAndOpenRelated = async (relatedWorkKey: string) => {
    try {
      const imported = await apiRequest<{ work: { id: string } }>(
        supabase,
        "/api/v1/books/import",
        {
          method: "POST",
          body: { work_key: relatedWorkKey },
        },
      );
      router.push(`/books/${imported.work.id}`);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Unable to open related book.",
      );
    }
  };

  return (
    <Card className="mt-6" data-test="book-discovery">
      <div className="mb-3">
        <p className="text-sm font-medium">Discovery</p>
        <p className="text-xs text-slate-500">
          Recommended from related titles and your authors.
        </p>
      </div>
      {error ? (
        <Message className="mb-2" severity="error" text={error} />
      ) : null}

      <div className="space-y-5">
        <section>
          <p className="text-sm font-medium">Related books</p>
          {relatedLoading ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : visibleRelatedBooks.length ? (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
              {visibleRelatedBooks.map((item) => (
                <Button
                  key={item.work_key}
                  text
                  className="rounded border border-slate-200 p-2 text-left hover:bg-slate-50"
                  data-test={`related-book-${item.work_key}`}
                  onClick={() => void importAndOpenRelated(item.work_key)}
                >
                  <p className="line-clamp-2 text-xs font-semibold">
                    {item.title}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {relatedAuthorLabel(item)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {item.first_publish_year ?? "Year unknown"}
                  </p>
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              No related books with covers yet.
            </p>
          )}
        </section>

        <section>
          <p className="text-sm font-medium">More from the author(s)</p>
          {authorLoading ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : authorProfilesWithCoverWorks.length ? (
            <div className="mt-2 grid gap-3">
              {authorProfilesWithCoverWorks.map((author) => (
                <Card key={author.id} className="rounded border border-slate-200 p-3">
                  <p className="text-sm font-medium">{author.name}</p>
                  {author.bio ? (
                    <p className="line-clamp-1 text-xs text-slate-500">
                      {author.bio}
                    </p>
                  ) : null}
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {author.works.slice(0, 6).map((book) => (
                      <Button
                        key={`${author.id}-${book.work_key}`}
                        text
                        className="rounded border border-slate-200 p-2 text-left hover:bg-slate-50"
                        data-test={`author-work-${book.work_key}`}
                        onClick={() => void importAndOpenRelated(book.work_key)}
                      >
                        <p className="line-clamp-2 text-xs font-medium">
                          {book.title}
                        </p>
                      </Button>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              No author books with covers yet.
            </p>
          )}
        </section>
      </div>
    </Card>
  );
}

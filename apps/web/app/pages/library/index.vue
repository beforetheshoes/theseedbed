<template>
  <div class="flex flex-col gap-4">
    <!-- Nuxt page transitions require a single root element. -->
    <Card data-test="library-card">
      <template #title>
        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <i class="pi pi-book text-primary" aria-hidden="true"></i>
            <div>
              <p class="font-serif text-xl font-semibold tracking-tight">Your library</p>
              <p class="text-sm text-[var(--p-text-muted-color)]">
                Filter, sort, and jump back into a book.
              </p>
              <p class="text-xs text-[var(--p-text-muted-color)]" data-test="library-range-summary">
                {{ pageRangeLabel }}
              </p>
            </div>
          </div>
        </div>
      </template>
      <template #content>
        <div class="flex flex-col gap-4">
          <Card>
            <template #content>
              <div
                class="grid w-full grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5 2xl:grid-cols-6"
              >
                <SelectButton
                  v-model="viewMode"
                  :options="viewModeOptions"
                  option-label="label"
                  option-value="value"
                  aria-label="Library view mode"
                  data-test="library-view-select"
                  class="min-w-0 w-full"
                />
                <Select
                  v-model="statusFilter"
                  :options="statusFilters"
                  option-label="label"
                  option-value="value"
                  data-test="library-status-filter"
                  class="min-w-0 w-full"
                />
                <Select
                  v-model="visibilityFilter"
                  :options="visibilityFilters"
                  option-label="label"
                  option-value="value"
                  data-test="library-visibility-filter"
                  class="min-w-0 w-full"
                />
                <InputText
                  v-model="tagFilter"
                  placeholder="Filter by tag"
                  data-test="library-tag-filter"
                  class="min-w-0 w-full"
                />
                <Select
                  v-model="sortMode"
                  :options="sortOptions"
                  option-label="label"
                  option-value="value"
                  data-test="library-sort-select"
                  class="min-w-0 w-full"
                />
                <MultiSelect
                  v-if="viewMode === 'table'"
                  v-model="tableColumns"
                  :options="tableColumnOptions"
                  option-label="label"
                  option-value="value"
                  display="chip"
                  :max-selected-labels="1"
                  selected-items-label="{0} columns"
                  placeholder="Columns"
                  data-test="library-columns-select"
                  class="min-w-0 w-full"
                />
              </div>
            </template>
          </Card>

          <Message v-if="error" severity="error" :closable="false" data-test="library-error">{{
            error
          }}</Message>

          <!-- Skeleton loading -->
          <div v-if="loading" class="grid gap-3" data-test="library-loading">
            <Card v-for="n in 4" :key="n">
              <template #content>
                <div class="flex items-start gap-4">
                  <Skeleton width="80px" height="120px" borderRadius="0.5rem" class="shrink-0" />
                  <div class="flex flex-1 flex-col gap-2 pt-1">
                    <Skeleton width="75%" height="1.25rem" />
                    <Skeleton width="50%" height="1rem" />
                    <div class="mt-2 flex gap-2">
                      <Skeleton width="4rem" height="1.25rem" borderRadius="9999px" />
                      <Skeleton width="3.5rem" height="1.25rem" borderRadius="9999px" />
                    </div>
                  </div>
                </div>
              </template>
            </Card>
          </div>

          <template v-else-if="displayItems.length">
            <DataTable
              v-if="viewMode === 'table'"
              :value="displayItems"
              data-key="id"
              size="small"
              striped-rows
              row-hover
              class="w-full library-table"
              data-test="library-items-table"
            >
              <Column v-if="isColumnVisible('cover')" class="w-[72px] min-w-[72px]">
                <template #header>
                  <span class="library-header-label">Cover</span>
                </template>
                <template #body="slotProps">
                  <div class="flex justify-center">
                    <div
                      class="h-14 w-10 overflow-hidden rounded-md border border-[var(--p-content-border-color)] bg-black/5 dark:bg-white/5"
                    >
                      <Image
                        v-if="slotProps.data.cover_url"
                        :src="slotProps.data.cover_url"
                        alt=""
                        :preview="false"
                        class="h-full w-full"
                        image-class="h-full w-full object-cover"
                        data-test="library-item-cover"
                      />
                      <CoverPlaceholder v-else data-test="library-item-cover-placeholder" />
                    </div>
                  </div>
                </template>
              </Column>

              <Column v-if="isColumnVisible('title')" class="min-w-[14rem]">
                <template #header>
                  <button
                    type="button"
                    class="library-sort-trigger"
                    data-test="library-table-sort-title"
                    @click="toggleTitleSort"
                  >
                    Title
                    <i :class="titleSortIcon" aria-hidden="true"></i>
                  </button>
                </template>
                <template #body="slotProps">
                  <div class="min-w-0">
                    <NuxtLink
                      :to="`/books/${slotProps.data.work_id}`"
                      class="line-clamp-1 block font-semibold text-primary no-underline hover:underline focus-visible:underline"
                      data-test="library-item-title-link"
                    >
                      {{ slotProps.data.work_title }}
                    </NuxtLink>
                  </div>
                </template>
              </Column>

              <Column v-if="isColumnVisible('author')" class="min-w-[10rem]">
                <template #header>
                  <button
                    type="button"
                    class="library-sort-trigger"
                    data-test="library-table-sort-author"
                    @click="toggleAuthorSort"
                  >
                    Author
                    <i :class="authorSortIcon" aria-hidden="true"></i>
                  </button>
                </template>
                <template #body="slotProps">
                  <p class="line-clamp-1 text-sm text-[var(--p-text-muted-color)]">
                    {{ slotProps.data.author_names?.join(', ') || 'Unknown author' }}
                  </p>
                </template>
              </Column>

              <Column v-if="isColumnVisible('status')" class="min-w-[12rem]">
                <template #header>
                  <button
                    type="button"
                    class="library-sort-trigger"
                    data-test="library-table-sort-status"
                    @click="toggleStatusSort"
                  >
                    Status
                    <i :class="statusSortIcon" aria-hidden="true"></i>
                  </button>
                </template>
                <template #body="slotProps">
                  <div class="flex justify-center">
                    <Inplace
                      :disabled="isItemUpdating(slotProps.data.id)"
                      class="library-inline-editor"
                    >
                      <template #display>
                        <Tag
                          :value="libraryStatusLabel(slotProps.data.status)"
                          :pt="statusTagPt(slotProps.data.status)"
                          icon="pi pi-bookmark"
                          rounded
                          data-test="library-item-status-chip"
                        />
                      </template>
                      <template #content="{ closeCallback }">
                        <Select
                          :model-value="slotProps.data.status"
                          :options="statusEditOptions"
                          option-label="label"
                          option-value="value"
                          size="small"
                          data-test="library-item-status-edit"
                          :data-item-id="slotProps.data.id"
                          class="w-[11rem]"
                          :loading="isItemFieldUpdating(slotProps.data.id, 'status')"
                          :disabled="isItemUpdating(slotProps.data.id)"
                          @update:model-value="
                            onStatusEditAndClose(slotProps.data, $event, closeCallback)
                          "
                        />
                      </template>
                    </Inplace>
                  </div>
                </template>
              </Column>

              <Column class="min-w-[12rem]">
                <template #header>
                  <span class="library-header-label">Visibility</span>
                </template>
                <template #body="slotProps">
                  <div class="flex justify-center">
                    <Inplace
                      :disabled="isItemUpdating(slotProps.data.id)"
                      class="library-inline-editor"
                    >
                      <template #display>
                        <Tag
                          :value="libraryVisibilityLabel(slotProps.data.visibility)"
                          :pt="visibilityTagPt(slotProps.data.visibility)"
                          :icon="visibilityTagIcon(slotProps.data.visibility)"
                          rounded
                          data-test="library-item-visibility-chip"
                        />
                      </template>
                      <template #content="{ closeCallback }">
                        <Select
                          :model-value="slotProps.data.visibility"
                          :options="visibilityEditOptions"
                          option-label="label"
                          option-value="value"
                          size="small"
                          data-test="library-item-visibility-edit"
                          :data-item-id="slotProps.data.id"
                          class="w-[11rem]"
                          :loading="isItemFieldUpdating(slotProps.data.id, 'visibility')"
                          :disabled="isItemUpdating(slotProps.data.id)"
                          @update:model-value="
                            onVisibilityEditAndClose(slotProps.data, $event, closeCallback)
                          "
                        />
                      </template>
                    </Inplace>
                  </div>
                </template>
              </Column>

              <Column v-if="isColumnVisible('description')" class="min-w-[18rem]">
                <template #header>
                  <span class="library-header-label">Description</span>
                </template>
                <template #body="slotProps">
                  <p
                    class="library-description line-clamp-2 text-sm text-[var(--p-text-muted-color)]"
                    data-test="library-item-description"
                    v-html="renderDescriptionSnippet(slotProps.data.work_description)"
                  />
                </template>
              </Column>

              <Column v-if="isColumnVisible('rating')" class="min-w-[12rem]">
                <template #header>
                  <button
                    type="button"
                    class="library-sort-trigger"
                    data-test="library-table-sort-rating"
                    @click="toggleRatingSort"
                  >
                    Rating
                    <i :class="ratingSortIcon" aria-hidden="true"></i>
                  </button>
                </template>
                <template #body="slotProps">
                  <div class="flex justify-center">
                    <Rating
                      :model-value="ratingValue(slotProps.data.rating)"
                      :stars="5"
                      readonly
                      :cancel="false"
                      class="text-xs"
                      data-test="library-item-rating"
                    />
                  </div>
                </template>
              </Column>

              <Column v-if="isColumnVisible('tags')" class="min-w-[10rem]">
                <template #header>
                  <span class="library-header-label">Tags</span>
                </template>
                <template #body="slotProps">
                  <div class="flex flex-wrap items-center gap-1">
                    <div
                      v-for="tag in visibleTags(slotProps.data.tags, 2)"
                      :key="`${slotProps.data.id}-${tag}`"
                      class="library-meta-chip"
                    >
                      {{ tag }}
                    </div>
                    <span
                      v-if="remainingTagCount(slotProps.data.tags, 2)"
                      class="text-xs text-[var(--p-text-muted-color)]"
                    >
                      +{{ remainingTagCount(slotProps.data.tags, 2) }}
                    </span>
                    <span
                      v-if="!visibleTags(slotProps.data.tags, 2).length"
                      class="text-xs text-[var(--p-text-muted-color)]"
                    >
                      —
                    </span>
                  </div>
                </template>
              </Column>

              <Column v-if="isColumnVisible('recommendations')" class="min-w-[10rem]">
                <template #header>
                  <span class="library-header-label">Friends recs</span>
                </template>
                <template #body="slotProps">
                  <div class="library-meta-chip" data-test="library-item-recs">
                    <i class="pi pi-users text-xs" aria-hidden="true"></i>
                    <span>{{
                      recommendationLabel(slotProps.data.friend_recommendations_count)
                    }}</span>
                  </div>
                </template>
              </Column>

              <Column v-if="isColumnVisible('last_read')" class="min-w-[8rem]">
                <template #header>
                  <span class="library-header-label">Last read</span>
                </template>
                <template #body="slotProps">
                  {{ formatLastReadAt(slotProps.data.last_read_at) }}
                </template>
              </Column>

              <Column v-if="isColumnVisible('added')" class="min-w-[8rem]">
                <template #header>
                  <button
                    type="button"
                    class="library-sort-trigger"
                    data-test="library-table-sort-added"
                    @click="toggleAddedSort"
                  >
                    Added
                    <i :class="addedSortIcon" aria-hidden="true"></i>
                  </button>
                </template>
                <template #body="slotProps">
                  <span class="block text-center">
                    {{ formatCreatedAt(slotProps.data.created_at) }}
                  </span>
                </template>
              </Column>

              <Column class="w-[7rem] min-w-[7rem]">
                <template #header>
                  <span class="library-header-label">Actions</span>
                </template>
                <template #body="slotProps">
                  <div class="flex justify-center">
                    <Button
                      icon="pi pi-trash"
                      size="small"
                      text
                      severity="secondary"
                      aria-label="Remove from library"
                      class="opacity-70 transition-opacity hover:opacity-100"
                      data-test="library-item-remove"
                      :disabled="isItemUpdating(slotProps.data.id)"
                      @click="openRemoveConfirm(slotProps.data)"
                    />
                  </div>
                </template>
              </Column>
            </DataTable>

            <DataView
              v-else
              :value="displayItems"
              :layout="viewMode === 'grid' ? 'grid' : 'list'"
              data-test="library-data-view"
            >
              <template #list="slotProps">
                <div class="grid gap-3" data-test="library-items">
                  <div v-for="item in slotProps.items" :key="item.id" class="block">
                    <Card class="transition-shadow duration-200 hover:shadow-md">
                      <template #content>
                        <div
                          class="grid grid-cols-1 gap-3 md:h-[16rem] md:grid-cols-[10.75rem_minmax(0,1fr)_auto] md:items-stretch md:gap-4"
                        >
                          <div
                            class="mx-auto h-[168px] w-[112px] shrink-0 overflow-hidden rounded-lg border border-[var(--p-content-border-color)] md:mx-0 md:h-full md:w-full"
                          >
                            <Image
                              v-if="item.cover_url"
                              :src="item.cover_url"
                              alt=""
                              :preview="false"
                              class="h-full w-full"
                              image-class="h-full w-full object-contain"
                              data-test="library-item-cover"
                            />
                            <CoverPlaceholder v-else data-test="library-item-cover-placeholder" />
                          </div>

                          <div class="min-w-0 flex min-h-[168px] flex-col">
                            <NuxtLink
                              :to="`/books/${item.work_id}`"
                              class="line-clamp-2 font-serif text-lg font-semibold tracking-tight text-primary no-underline hover:underline focus-visible:underline"
                              data-test="library-item-title-link"
                            >
                              {{ item.work_title }}
                            </NuxtLink>
                            <p
                              v-if="item.author_names?.length"
                              class="mt-0.5 truncate text-sm text-[var(--p-text-muted-color)]"
                            >
                              {{ item.author_names.join(', ') }}
                            </p>
                            <p
                              class="library-description mt-1 line-clamp-6 overflow-hidden text-sm text-[var(--p-text-muted-color)]"
                              data-test="library-item-description"
                              v-html="renderDescriptionSnippet(item.work_description)"
                            />
                            <div
                              class="mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--p-content-border-color)]/60 pt-2"
                            >
                              <Inplace
                                :disabled="isItemUpdating(item.id)"
                                class="library-inline-editor"
                              >
                                <template #display>
                                  <Tag
                                    :value="libraryStatusLabel(item.status)"
                                    :pt="statusTagPt(item.status)"
                                    icon="pi pi-bookmark"
                                    rounded
                                    data-test="library-item-status-chip"
                                  />
                                </template>
                                <template #content="{ closeCallback }">
                                  <Select
                                    :model-value="item.status"
                                    :options="statusEditOptions"
                                    option-label="label"
                                    option-value="value"
                                    size="small"
                                    data-test="library-item-status-edit"
                                    :data-item-id="item.id"
                                    class="w-[10.5rem]"
                                    :loading="isItemFieldUpdating(item.id, 'status')"
                                    :disabled="isItemUpdating(item.id)"
                                    @update:model-value="
                                      onStatusEditAndClose(item, $event, closeCallback)
                                    "
                                  />
                                </template>
                              </Inplace>
                              <Inplace
                                :disabled="isItemUpdating(item.id)"
                                class="library-inline-editor"
                              >
                                <template #display>
                                  <Tag
                                    :value="libraryVisibilityLabel(item.visibility)"
                                    :pt="visibilityTagPt(item.visibility)"
                                    :icon="visibilityTagIcon(item.visibility)"
                                    rounded
                                    data-test="library-item-visibility-chip"
                                  />
                                </template>
                                <template #content="{ closeCallback }">
                                  <Select
                                    :model-value="item.visibility"
                                    :options="visibilityEditOptions"
                                    option-label="label"
                                    option-value="value"
                                    size="small"
                                    data-test="library-item-visibility-edit"
                                    :data-item-id="item.id"
                                    class="w-[10.5rem]"
                                    :loading="isItemFieldUpdating(item.id, 'visibility')"
                                    :disabled="isItemUpdating(item.id)"
                                    @update:model-value="
                                      onVisibilityEditAndClose(item, $event, closeCallback)
                                    "
                                  />
                                </template>
                              </Inplace>
                              <div
                                class="flex min-w-[7rem] flex-col items-center justify-center gap-0.5 text-center text-xs"
                                data-test="library-item-rating"
                              >
                                <Rating
                                  :model-value="ratingValue(item.rating)"
                                  :stars="5"
                                  readonly
                                  :cancel="false"
                                  class="text-xs"
                                />
                                <span
                                  class="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--p-text-muted-color)]"
                                >
                                  Rating
                                </span>
                              </div>
                              <div class="library-meta-chip" data-test="library-item-recs">
                                <i class="pi pi-users text-xs" aria-hidden="true"></i>
                                <span>{{
                                  recommendationLabel(item.friend_recommendations_count)
                                }}</span>
                              </div>
                              <div
                                v-for="tag in visibleTags(item.tags, 2)"
                                :key="`${item.id}-${tag}`"
                                class="library-meta-chip"
                              >
                                {{ tag }}
                              </div>
                              <div v-if="remainingTagCount(item.tags, 2)" class="library-meta-chip">
                                +{{ remainingTagCount(item.tags, 2) }}
                              </div>
                            </div>
                          </div>

                          <div class="shrink-0 md:self-start">
                            <Button
                              icon="pi pi-trash"
                              size="small"
                              variant="text"
                              severity="secondary"
                              class="self-start opacity-70 transition-opacity hover:opacity-100"
                              aria-label="Remove from library"
                              data-test="library-item-remove"
                              :disabled="isItemUpdating(item.id)"
                              @click.stop="openRemoveConfirm(item)"
                            />
                          </div>
                        </div>
                      </template>
                    </Card>
                  </div>
                </div>
              </template>

              <template #grid="slotProps">
                <div
                  class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                  data-test="library-items-grid"
                >
                  <Card
                    v-for="item in slotProps.items"
                    :key="item.id"
                    class="group h-full transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                  >
                    <template #content>
                      <div class="flex h-full flex-col gap-1 pt-1">
                        <div
                          class="grid min-h-[10.5rem] grid-cols-2 rounded-xl bg-gradient-to-r from-black/10 via-transparent to-transparent py-2 dark:from-white/5"
                        >
                          <div class="flex items-start justify-center">
                            <div
                              class="h-[176px] w-[118px] shrink-0 overflow-hidden rounded-lg border border-[var(--p-content-border-color)] bg-black/5 dark:bg-white/5 transition-transform duration-200 group-hover:scale-[1.02]"
                            >
                              <Image
                                v-if="item.cover_url"
                                :src="item.cover_url"
                                alt=""
                                :preview="false"
                                class="h-full w-full"
                                image-class="h-full w-full object-cover"
                                data-test="library-item-cover"
                              />
                              <CoverPlaceholder v-else data-test="library-item-cover-placeholder" />
                            </div>
                          </div>
                          <div class="flex min-w-0 items-start justify-center">
                            <div
                              class="flex h-full min-h-[8.75rem] w-full flex-col justify-between pb-1"
                            >
                              <div class="-mt-1 flex justify-end">
                                <Button
                                  icon="pi pi-trash"
                                  size="small"
                                  variant="text"
                                  severity="secondary"
                                  class="opacity-70 transition-opacity hover:opacity-100"
                                  aria-label="Remove from library"
                                  data-test="library-item-remove"
                                  :disabled="isItemUpdating(item.id)"
                                  @click.stop="openRemoveConfirm(item)"
                                />
                              </div>
                              <Inplace
                                :disabled="isItemUpdating(item.id)"
                                class="library-inline-editor mx-auto"
                              >
                                <template #display>
                                  <Tag
                                    :value="libraryStatusLabel(item.status)"
                                    :pt="statusTagPt(item.status)"
                                    icon="pi pi-bookmark"
                                    rounded
                                    data-test="library-item-status-chip"
                                  />
                                </template>
                                <template #content="{ closeCallback }">
                                  <Select
                                    :model-value="item.status"
                                    :options="statusEditOptions"
                                    option-label="label"
                                    option-value="value"
                                    size="small"
                                    data-test="library-item-status-edit"
                                    :data-item-id="item.id"
                                    class="w-[10.5rem]"
                                    :loading="isItemFieldUpdating(item.id, 'status')"
                                    :disabled="isItemUpdating(item.id)"
                                    @update:model-value="
                                      onStatusEditAndClose(item, $event, closeCallback)
                                    "
                                  />
                                </template>
                              </Inplace>
                              <Inplace
                                :disabled="isItemUpdating(item.id)"
                                class="library-inline-editor mx-auto"
                              >
                                <template #display>
                                  <Tag
                                    :value="libraryVisibilityLabel(item.visibility)"
                                    :pt="visibilityTagPt(item.visibility)"
                                    :icon="visibilityTagIcon(item.visibility)"
                                    rounded
                                    data-test="library-item-visibility-chip"
                                  />
                                </template>
                                <template #content="{ closeCallback }">
                                  <Select
                                    :model-value="item.visibility"
                                    :options="visibilityEditOptions"
                                    option-label="label"
                                    option-value="value"
                                    size="small"
                                    data-test="library-item-visibility-edit"
                                    :data-item-id="item.id"
                                    class="w-[10.5rem]"
                                    :loading="isItemFieldUpdating(item.id, 'visibility')"
                                    :disabled="isItemUpdating(item.id)"
                                    @update:model-value="
                                      onVisibilityEditAndClose(item, $event, closeCallback)
                                    "
                                  />
                                </template>
                              </Inplace>
                              <div
                                class="mx-auto flex min-w-[7rem] flex-col items-center gap-0.5 text-center text-xs"
                                data-test="library-item-rating"
                              >
                                <Rating
                                  :model-value="ratingValue(item.rating)"
                                  :stars="5"
                                  readonly
                                  :cancel="false"
                                  class="text-xs"
                                />
                                <span
                                  class="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--p-text-muted-color)]"
                                >
                                  Rating
                                </span>
                                <span
                                  v-if="item.rating !== null && item.rating !== undefined"
                                  class="text-xs text-[var(--p-text-muted-color)]"
                                >
                                  {{ ratingLabel(item.rating) }}
                                </span>
                              </div>
                              <div
                                class="library-meta-chip mx-auto justify-center whitespace-nowrap"
                                data-test="library-item-recs"
                              >
                                <i class="pi pi-users text-xs" aria-hidden="true"></i>
                                <span>{{
                                  recommendationLabel(item.friend_recommendations_count)
                                }}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div class="min-w-0">
                          <NuxtLink
                            :to="`/books/${item.work_id}`"
                            class="line-clamp-2 block text-center font-serif text-lg font-semibold tracking-tight text-primary no-underline hover:underline focus-visible:underline"
                            data-test="library-item-title-link"
                          >
                            {{ item.work_title }}
                          </NuxtLink>
                          <p
                            v-if="item.author_names?.length"
                            class="mt-0.5 truncate text-center text-sm text-[var(--p-text-muted-color)]"
                          >
                            {{ item.author_names.join(', ') }}
                          </p>
                          <div
                            v-if="
                              visibleTags(item.tags, 2).length > 0 ||
                              remainingTagCount(item.tags, 2) > 0
                            "
                            class="mt-1 flex flex-wrap justify-center gap-1"
                          >
                            <div
                              v-for="tag in visibleTags(item.tags, 2)"
                              :key="`${item.id}-${tag}`"
                              class="library-meta-chip"
                            >
                              {{ tag }}
                            </div>
                            <div v-if="remainingTagCount(item.tags, 2)" class="library-meta-chip">
                              +{{ remainingTagCount(item.tags, 2) }}
                            </div>
                          </div>
                        </div>

                        <p
                          class="library-description mt-0.5 line-clamp-4 text-left text-sm text-[var(--p-text-muted-color)]"
                          data-test="library-item-description"
                          v-html="renderDescriptionSnippet(item.work_description)"
                        />
                      </div>
                    </template>
                  </Card>
                </div>
              </template>
            </DataView>
          </template>

          <EmptyState
            v-else
            data-test="library-empty"
            icon="pi pi-inbox"
            title="No library items found."
            body="Use the search bar in the top navigation to import books into your library."
          />

          <div
            v-if="totalCount > 0"
            class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <p
              class="text-sm text-[var(--p-text-muted-color)]"
              data-test="library-pagination-summary"
            >
              {{ pageRangeLabel }} books
            </p>
            <Paginator
              :first="Math.max(0, (page - 1) * pageSize)"
              :rows="pageSize"
              :total-records="totalCount"
              :rows-per-page-options="[10, 25, 50, 100]"
              data-test="library-paginator"
              @page="onPageChange"
            />
          </div>
        </div>
      </template>
    </Card>

    <Dialog
      v-model:visible="readDateDialogOpen"
      modal
      :header="readDateDialogHeader"
      :draggable="false"
      style="width: 40rem"
      data-test="library-read-date-dialog"
    >
      <div class="flex flex-col gap-4">
        <p class="text-sm text-[var(--p-text-muted-color)]">
          {{ readDateDialogBody }}
        </p>
        <Message v-if="readDateFormError" severity="error" :closable="false">
          {{ readDateFormError }}
        </Message>

        <template v-if="readDateDialogStatus === 'reading'">
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <span class="self-center text-sm font-medium">Current read start</span>
            <DatePicker
              v-model="readingCurrentStartDate"
              show-icon
              fluid
              :manual-input="false"
              :max-date="readDateMaxDate"
              data-test="library-read-current-start"
            />
          </div>

          <div class="flex items-center justify-between">
            <p class="text-sm font-medium">Previous completed reads</p>
            <Button
              label="Add previous read"
              icon="pi pi-plus"
              size="small"
              severity="secondary"
              variant="outlined"
              data-test="library-read-date-add-previous"
              :disabled="readDateSaving"
              @click.stop.prevent="addPreviousReadEntry"
            />
          </div>

          <div v-if="previousReadEntries.length" class="flex flex-col gap-2">
            <div
              v-for="(entry, index) in previousReadEntries"
              :key="entry.key"
              class="grid grid-cols-1 gap-2 rounded-lg border border-[var(--p-content-border-color)] p-3 sm:grid-cols-[1fr_auto]"
            >
              <DatePicker
                :model-value="readDateRangeModel(entry)"
                selection-mode="range"
                show-icon
                fluid
                :manual-input="false"
                :max-date="readDateMaxDate"
                :data-test="`library-read-previous-range-${index}`"
                @update:model-value="
                  entry.startedAt = Array.isArray($event) ? ($event[0] ?? null) : null;
                  entry.endedAt = Array.isArray($event) ? ($event[1] ?? null) : null;
                "
              />
              <Button
                icon="pi pi-trash"
                size="small"
                severity="secondary"
                variant="text"
                class="sm:self-center"
                :aria-label="`Remove previous read ${index + 1}`"
                :disabled="readDateSaving"
                @click="removePreviousReadEntry(entry.key)"
              />
            </div>
          </div>
        </template>

        <template v-else>
          <div class="flex items-center justify-between">
            <p class="text-sm font-medium">Completed reads</p>
            <Button
              label="Add another read"
              icon="pi pi-plus"
              size="small"
              severity="secondary"
              variant="outlined"
              data-test="library-read-date-add-completed"
              :disabled="readDateSaving"
              @click.stop.prevent="addCompletedReadEntry"
            />
          </div>

          <div class="flex flex-col gap-2">
            <div
              v-for="(entry, index) in completedReadEntries"
              :key="entry.key"
              class="grid grid-cols-1 gap-2 rounded-lg border border-[var(--p-content-border-color)] p-3 sm:grid-cols-[1fr_auto]"
            >
              <DatePicker
                :model-value="readDateRangeModel(entry)"
                selection-mode="range"
                show-icon
                fluid
                :manual-input="false"
                :max-date="readDateMaxDate"
                :data-test="`library-read-completed-range-${index}`"
                @update:model-value="
                  entry.startedAt = Array.isArray($event) ? ($event[0] ?? null) : null;
                  entry.endedAt = Array.isArray($event) ? ($event[1] ?? null) : null;
                "
              />
              <Button
                v-if="completedReadEntries.length > 1"
                icon="pi pi-trash"
                size="small"
                severity="secondary"
                variant="text"
                class="sm:self-center"
                :aria-label="`Remove completed read ${index + 1}`"
                :disabled="readDateSaving"
                @click="removeCompletedReadEntry(entry.key)"
              />
            </div>
          </div>
        </template>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <Button
            :label="readDateTodayButtonLabel"
            severity="secondary"
            variant="outlined"
            data-test="library-read-date-today"
            :loading="readDateSaving"
            :disabled="readDateSaving"
            @click="saveReadDatePrompt(true)"
          />
          <Button
            label="Skip for now"
            severity="secondary"
            variant="text"
            data-test="library-read-date-skip"
            :disabled="readDateSaving"
            @click="closeReadDatePrompt"
          />
          <Button
            :label="readDateSaveButtonLabel"
            data-test="library-read-date-save"
            :loading="readDateSaving"
            :disabled="readDateSaving"
            @click="saveReadDatePrompt()"
          />
        </div>
      </div>
    </Dialog>

    <Dialog
      v-model:visible="removeConfirmOpen"
      modal
      header="Remove from library"
      :draggable="false"
      style="width: 32rem"
      data-test="library-remove-dialog"
    >
      <div class="flex flex-col gap-4">
        <div>
          <p class="text-sm text-[var(--p-text-muted-color)]">
            Remove "{{ pendingRemoveItem?.work_title ?? '' }}" from your library? This cannot be
            undone.
          </p>
        </div>
        <div class="flex items-center justify-end gap-2">
          <Button
            label="Cancel"
            severity="secondary"
            variant="text"
            data-test="library-remove-cancel"
            :disabled="removeConfirmLoading"
            @click="cancelRemoveConfirm"
          />
          <Button
            label="Remove"
            severity="danger"
            data-test="library-remove-confirm"
            :loading="removeConfirmLoading"
            @click="confirmRemove"
          />
        </div>
      </div>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'app', middleware: 'auth' });

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useToast } from 'primevue/usetoast';
import { ApiClientError, apiRequest } from '~/utils/api';
import { renderDescriptionHtml } from '~/utils/description';
import { libraryStatusLabel } from '~/utils/libraryStatus';
import CoverPlaceholder from '~/components/CoverPlaceholder.vue';
import EmptyState from '~/components/EmptyState.vue';

const toast = useToast();
const EMPTY_DESCRIPTION_LABEL = 'No description available.';

type LibraryViewMode = 'current' | 'grid' | 'table';
type LibraryItemStatus = 'to_read' | 'reading' | 'completed' | 'abandoned';
type LibraryItemVisibility = 'private' | 'public';
type SortMode =
  | 'newest'
  | 'oldest'
  | 'title_asc'
  | 'title_desc'
  | 'author_asc'
  | 'author_desc'
  | 'status_asc'
  | 'status_desc'
  | 'rating_asc'
  | 'rating_desc';
type TableColumnKey =
  | 'cover'
  | 'title'
  | 'author'
  | 'status'
  | 'description'
  | 'rating'
  | 'tags'
  | 'recommendations'
  | 'last_read'
  | 'added';

type LibraryItem = {
  id: string;
  work_id: string;
  work_title: string;
  work_description?: string | null;
  friend_recommendations_count?: number | null;
  author_names?: string[];
  cover_url?: string | null;
  status: LibraryItemStatus;
  visibility: LibraryItemVisibility;
  rating?: number | null;
  tags?: string[];
  last_read_at?: string | null;
  created_at?: string;
};
type LibraryPagination = {
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
  from: number;
  to: number;
  has_prev: boolean;
  has_next: boolean;
};

const LIBRARY_UPDATED_EVENT = 'chapterverse:library-updated';
const VIEW_MODE_STORAGE_KEY = 'seedbed.library.viewMode';
const TABLE_COLUMNS_STORAGE_KEY = 'seedbed.library.tableColumns';
const ALL_TABLE_COLUMNS = [
  'cover',
  'title',
  'author',
  'status',
  'description',
  'rating',
  'tags',
  'recommendations',
  'last_read',
  'added',
] as const satisfies readonly TableColumnKey[];
const DEFAULT_TABLE_COLUMNS = [
  'cover',
  'title',
  'author',
  'status',
  'description',
  'rating',
  'tags',
  'added',
] as const satisfies readonly TableColumnKey[];

const items = ref<LibraryItem[]>([]);
const viewMode = ref<LibraryViewMode>('current');
const statusFilter = ref<string>('');
const visibilityFilter = ref<string>('');
const tagFilter = ref('');
const sortMode = ref<SortMode>('newest');
const tableColumns = ref<TableColumnKey[]>([...DEFAULT_TABLE_COLUMNS]);
const page = ref(1);
const pageSize = ref(25);
const totalCount = ref(0);
const totalPages = ref(0);
const pageFrom = ref(0);
const pageTo = ref(0);
const loading = ref(false);
const error = ref('');
const tagFilterDebounceTimer = ref<number | null>(null);

const pendingRemoveItem = ref<LibraryItem | null>(null);
const removeConfirmOpen = ref(false);
const removeConfirmLoading = ref(false);
const itemFieldUpdates = ref<Record<string, boolean>>({});
const itemReadDateUpdates = ref<Record<string, boolean>>({});
const readDateDialogOpen = ref(false);
const readDateDialogStatus = ref<LibraryItemStatus | null>(null);
const readDateTargetItem = ref<LibraryItem | null>(null);
type ReadDateEntry = { key: string; startedAt: Date | null; endedAt: Date | null };
const readingCurrentStartDate = ref<Date | null>(null);
const previousReadEntries = ref<ReadDateEntry[]>([]);
const completedReadEntries = ref<ReadDateEntry[]>([]);
const readDateFormError = ref('');
const readDateSaving = ref(false);
const readDateMaxDate = new Date();
let readDateEntrySequence = 0;

const viewModeOptions = [
  { label: 'List', value: 'current' },
  { label: 'Grid', value: 'grid' },
  { label: 'Table', value: 'table' },
] satisfies Array<{ label: string; value: LibraryViewMode }>;

const statusFilters = [
  { label: 'All statuses', value: '' },
  { label: 'To read', value: 'to_read' },
  { label: 'Reading', value: 'reading' },
  { label: 'Completed', value: 'completed' },
  { label: 'Abandoned', value: 'abandoned' },
] satisfies Array<{ label: string; value: '' | LibraryItemStatus }>;

const visibilityFilters = [
  { label: 'All visibilities', value: '' },
  { label: 'Private', value: 'private' },
  { label: 'Public', value: 'public' },
] satisfies Array<{ label: string; value: '' | LibraryItemVisibility }>;

const statusEditOptions = statusFilters.filter((option) => option.value !== '');
const visibilityEditOptions = visibilityFilters.filter((option) => option.value !== '');

const sortOptions = [
  { label: 'Newest first', value: 'newest' },
  { label: 'Oldest first', value: 'oldest' },
  { label: 'Title A-Z', value: 'title_asc' },
  { label: 'Title Z-A', value: 'title_desc' },
  { label: 'Author A-Z', value: 'author_asc' },
  { label: 'Author Z-A', value: 'author_desc' },
  { label: 'Status A-Z', value: 'status_asc' },
  { label: 'Status Z-A', value: 'status_desc' },
  { label: 'Rating low-high', value: 'rating_asc' },
  { label: 'Rating high-low', value: 'rating_desc' },
] satisfies Array<{ label: string; value: SortMode }>;

const tableColumnOptions = [
  { label: 'Cover', value: 'cover' },
  { label: 'Title', value: 'title' },
  { label: 'Author', value: 'author' },
  { label: 'Status', value: 'status' },
  { label: 'Description', value: 'description' },
  { label: 'Rating', value: 'rating' },
  { label: 'Tags', value: 'tags' },
  { label: 'Recommendations', value: 'recommendations' },
  { label: 'Last read', value: 'last_read' },
  { label: 'Added', value: 'added' },
] satisfies Array<{ label: string; value: TableColumnKey }>;

const isLibraryViewMode = (value: string): value is LibraryViewMode =>
  value === 'current' || value === 'grid' || value === 'table';

const isTableColumnKey = (value: string): value is TableColumnKey =>
  (ALL_TABLE_COLUMNS as readonly string[]).includes(value);

const readStoredViewMode = (): LibraryViewMode => {
  const storage = globalThis.localStorage;
  if (!storage || typeof storage.getItem !== 'function') {
    return 'current';
  }

  try {
    const raw = storage.getItem(VIEW_MODE_STORAGE_KEY);
    return raw && isLibraryViewMode(raw) ? raw : 'current';
  } catch {
    return 'current';
  }
};

const writeStoredViewMode = (next: LibraryViewMode) => {
  const storage = globalThis.localStorage;
  if (!storage || typeof storage.setItem !== 'function') {
    return;
  }

  try {
    storage.setItem(VIEW_MODE_STORAGE_KEY, next);
  } catch {
    // Best-effort only.
  }
};

const normalizeStoredColumns = (value: unknown): TableColumnKey[] => {
  if (!Array.isArray(value)) return [...DEFAULT_TABLE_COLUMNS];
  const valid = value.filter((entry): entry is TableColumnKey =>
    typeof entry === 'string' ? isTableColumnKey(entry) : false,
  );
  return valid.length ? valid : [...DEFAULT_TABLE_COLUMNS];
};

const readStoredTableColumns = (): TableColumnKey[] => {
  const storage = globalThis.localStorage;
  if (!storage || typeof storage.getItem !== 'function') {
    return [...DEFAULT_TABLE_COLUMNS];
  }

  try {
    const raw = storage.getItem(TABLE_COLUMNS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_TABLE_COLUMNS];
    return normalizeStoredColumns(JSON.parse(raw));
  } catch {
    return [...DEFAULT_TABLE_COLUMNS];
  }
};

const writeStoredTableColumns = (next: TableColumnKey[]) => {
  const storage = globalThis.localStorage;
  if (!storage || typeof storage.setItem !== 'function') {
    return;
  }

  try {
    storage.setItem(TABLE_COLUMNS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best-effort only.
  }
};

const isColumnVisible = (key: TableColumnKey) => tableColumns.value.includes(key);

const titleSortIcon = computed(() => {
  if (sortMode.value === 'title_asc') return 'pi pi-sort-alpha-down';
  if (sortMode.value === 'title_desc') return 'pi pi-sort-alpha-up-alt';
  return 'pi pi-sort-alt';
});

const authorSortIcon = computed(() => {
  if (sortMode.value === 'author_asc') return 'pi pi-sort-alpha-down';
  if (sortMode.value === 'author_desc') return 'pi pi-sort-alpha-up-alt';
  return 'pi pi-sort-alt';
});

const statusSortIcon = computed(() => {
  if (sortMode.value === 'status_asc') return 'pi pi-sort-alpha-down';
  if (sortMode.value === 'status_desc') return 'pi pi-sort-alpha-up-alt';
  return 'pi pi-sort-alt';
});

const ratingSortIcon = computed(() => {
  if (sortMode.value === 'rating_asc') return 'pi pi-sort-amount-up';
  if (sortMode.value === 'rating_desc') return 'pi pi-sort-amount-down';
  return 'pi pi-sort-alt';
});

const addedSortIcon = computed(() => {
  if (sortMode.value === 'newest') return 'pi pi-sort-amount-down';
  if (sortMode.value === 'oldest') return 'pi pi-sort-amount-up';
  return 'pi pi-sort-alt';
});

const formatCreatedAt = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString();
};

const formatLastReadAt = (value?: string | null) => formatCreatedAt(value ?? undefined);

const descriptionSnippet = (value?: string | null) => {
  if (!value) return EMPTY_DESCRIPTION_LABEL;
  const normalized = value.trim();
  return normalized || EMPTY_DESCRIPTION_LABEL;
};

const renderDescriptionSnippet = (value?: string | null) => {
  const snippet = descriptionSnippet(value);
  if (snippet === EMPTY_DESCRIPTION_LABEL) return snippet;
  return renderDescriptionHtml(snippet, { inline: true });
};

const ratingValue = (value?: number | null) => {
  if (typeof value !== 'number') return 0;
  return Math.max(0, Math.min(5, Math.round(value / 2)));
};

const ratingLabel = (value?: number | null) => {
  if (typeof value !== 'number') return 'No rating';
  return `${value}/10`;
};

const libraryVisibilityLabel = (value: LibraryItemVisibility) =>
  value === 'public' ? 'Public' : 'Private';

const tagPtBase = {
  root: {
    class:
      'border px-2.5 py-1 font-semibold leading-none shadow-none transition-colors duration-150',
  },
  icon: {
    class: 'text-[0.72rem]',
  },
  label: {
    class: 'leading-none',
  },
} as const;

const statusTagPt = (value: LibraryItemStatus) => {
  if (value === 'reading') {
    return {
      ...tagPtBase,
      root: {
        class: `${tagPtBase.root.class} border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200`,
      },
    };
  }
  if (value === 'completed') {
    return {
      ...tagPtBase,
      root: {
        class: `${tagPtBase.root.class} border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200`,
      },
    };
  }
  if (value === 'abandoned') {
    return {
      ...tagPtBase,
      root: {
        class: `${tagPtBase.root.class} border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/55 dark:text-amber-200`,
      },
    };
  }
  return {
    ...tagPtBase,
    root: {
      class: `${tagPtBase.root.class} border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/55 dark:text-teal-200`,
    },
  };
};

const visibilityTagPt = (value: LibraryItemVisibility) => {
  if (value === 'public') {
    return {
      ...tagPtBase,
      root: {
        class: `${tagPtBase.root.class} border-2 border-solid border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200`,
      },
    };
  }
  return {
    ...tagPtBase,
    root: {
      class: `${tagPtBase.root.class} border-2 border-dashed border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200`,
    },
  };
};

const visibilityTagIcon = (value: LibraryItemVisibility) =>
  value === 'public' ? 'pi pi-eye' : 'pi pi-lock';

const visibleTags = (tags?: string[], max = 2) => (tags || []).slice(0, max);

const remainingTagCount = (tags?: string[], max = 2) => Math.max(0, (tags || []).length - max);

const recommendationLabel = (value?: number | null) => {
  if (typeof value !== 'number') return 'No recs';
  if (value <= 0) return '0 recs';
  if (value === 1) return '1 rec';
  return `${value} recs`;
};

const toggleTitleSort = () => {
  sortMode.value = sortMode.value === 'title_asc' ? 'title_desc' : 'title_asc';
};

const toggleAddedSort = () => {
  sortMode.value = sortMode.value === 'newest' ? 'oldest' : 'newest';
};

const toggleAuthorSort = () => {
  sortMode.value = sortMode.value === 'author_asc' ? 'author_desc' : 'author_asc';
};

const toggleStatusSort = () => {
  sortMode.value = sortMode.value === 'status_asc' ? 'status_desc' : 'status_asc';
};

const toggleRatingSort = () => {
  sortMode.value = sortMode.value === 'rating_asc' ? 'rating_desc' : 'rating_asc';
};

const firstAuthor = (item: LibraryItem) => item.author_names?.[0] ?? 'Unknown author';

const sortComparators = {
  newest: (a, b) => (b.created_at || '').localeCompare(a.created_at || ''),
  oldest: (a, b) => (a.created_at || '').localeCompare(b.created_at || ''),
  title_asc: (a, b) => a.work_title.localeCompare(b.work_title),
  title_desc: (a, b) => b.work_title.localeCompare(a.work_title),
  author_asc: (a, b) => firstAuthor(a).localeCompare(firstAuthor(b)),
  author_desc: (a, b) => firstAuthor(b).localeCompare(firstAuthor(a)),
  status_asc: (a, b) => libraryStatusLabel(a.status).localeCompare(libraryStatusLabel(b.status)),
  status_desc: (a, b) => libraryStatusLabel(b.status).localeCompare(libraryStatusLabel(a.status)),
  rating_asc: (a, b) =>
    Number((a.rating ?? Number.POSITIVE_INFINITY) > (b.rating ?? Number.POSITIVE_INFINITY)) -
    Number((a.rating ?? Number.POSITIVE_INFINITY) < (b.rating ?? Number.POSITIVE_INFINITY)),
  rating_desc: (a, b) =>
    Number((b.rating ?? Number.NEGATIVE_INFINITY) > (a.rating ?? Number.NEGATIVE_INFINITY)) -
    Number((b.rating ?? Number.NEGATIVE_INFINITY) < (a.rating ?? Number.NEGATIVE_INFINITY)),
} as const;

const displayItems = computed(() => {
  const tag = tagFilter.value.trim().toLowerCase();
  let filtered = items.value;
  if (tag) {
    filtered = filtered.filter((item) =>
      Array.isArray(item.tags) ? item.tags.some((t) => t.toLowerCase().includes(tag)) : false,
    );
  }

  const sorted = [...filtered];
  sorted.sort(sortComparators[sortMode.value]);
  return sorted;
});

const pageRangeLabel = computed(() => {
  if (!totalCount.value || !totalPages.value) return '0 items';
  return `${pageFrom.value}-${pageTo.value} of ${totalCount.value}`;
});

const readDateDialogHeader = computed(() => {
  if (readDateDialogStatus.value === 'reading') return 'Add reading start date';
  return 'Add completion date';
});

const readDateDialogBody = computed(() => {
  if (readDateDialogStatus.value === 'reading') {
    return 'Add a start date for your current read, and optionally log previous completed reads.';
  }
  return 'Add one or more completed reads, each with a start and finish date.';
});

const readDateTodayButtonLabel = computed(() => {
  if (readDateDialogStatus.value === 'reading') return 'Start today and save';
  return 'Add today read and save';
});

const readDateSaveButtonLabel = computed(() => {
  if (readDateDialogStatus.value === 'reading') return 'Save read history';
  return 'Save completed reads';
});

const itemFieldUpdateKey = (
  itemId: string,
  field: 'status' | 'visibility',
): `${string}:${'status' | 'visibility'}` => `${itemId}:${field}`;

const isItemFieldUpdating = (itemId: string, field: 'status' | 'visibility') =>
  Boolean(itemFieldUpdates.value[itemFieldUpdateKey(itemId, field)]);

const isItemReadDateUpdating = (itemId: string) => Boolean(itemReadDateUpdates.value[itemId]);

const isItemUpdating = (itemId: string) =>
  isItemFieldUpdating(itemId, 'status') ||
  isItemFieldUpdating(itemId, 'visibility') ||
  isItemReadDateUpdating(itemId);

const setItemFieldUpdating = (itemId: string, field: 'status' | 'visibility', next: boolean) => {
  const key = itemFieldUpdateKey(itemId, field);
  if (next) {
    itemFieldUpdates.value = { ...itemFieldUpdates.value, [key]: true };
    return;
  }
  const remaining = { ...itemFieldUpdates.value };
  delete remaining[key];
  itemFieldUpdates.value = remaining;
};

const setItemReadDateUpdating = (itemId: string, next: boolean) => {
  if (next) {
    itemReadDateUpdates.value = { ...itemReadDateUpdates.value, [itemId]: true };
    return;
  }
  const remaining = { ...itemReadDateUpdates.value };
  delete remaining[itemId];
  itemReadDateUpdates.value = remaining;
};

const updateLibraryItemField = async <TField extends 'status' | 'visibility'>(
  item: LibraryItem,
  field: TField,
  nextValue: LibraryItem[TField],
) => {
  if (item[field] === nextValue) return false;
  if (isItemFieldUpdating(item.id, field)) return false;

  const previousValue = item[field];
  item[field] = nextValue;
  setItemFieldUpdating(item.id, field, true);

  try {
    const payload = await apiRequest<LibraryItem>(`/api/v1/library/items/${item.id}`, {
      method: 'PATCH',
      body: { [field]: nextValue },
    });
    item.status = payload.status;
    item.visibility = payload.visibility;
    toast.add({
      severity: 'success',
      summary: field === 'status' ? 'Status updated.' : 'Visibility updated.',
      life: 2200,
    });
    return true;
  } catch (err) {
    item[field] = previousValue;
    if (err instanceof ApiClientError && err.status === 404) {
      toast.add({
        severity: 'info',
        summary: 'This item was already removed. Refreshing...',
        life: 3000,
      });
      await fetchPage();
    } else {
      const msg =
        err instanceof ApiClientError ? err.message : 'Unable to update this item right now.';
      toast.add({ severity: 'error', summary: msg, life: 3000 });
    }
    return false;
  } finally {
    setItemFieldUpdating(item.id, field, false);
  }
};

const statusEditValue = (next: unknown): LibraryItemStatus | null => {
  if (typeof next !== 'string') return null;
  if (!statusEditOptions.some((option) => option.value === next)) return null;
  return next as LibraryItemStatus;
};

const visibilityEditValue = (next: unknown): LibraryItemVisibility | null => {
  if (typeof next !== 'string') return null;
  if (!visibilityEditOptions.some((option) => option.value === next)) return null;
  return next as LibraryItemVisibility;
};

const onStatusEdit = async (item: LibraryItem, next: unknown) => {
  const value = statusEditValue(next);
  if (!value) return false;
  return updateLibraryItemField(item, 'status', value);
};

const onVisibilityEdit = async (item: LibraryItem, next: unknown) => {
  const value = visibilityEditValue(next);
  if (!value) return;
  await updateLibraryItemField(item, 'visibility', value);
};

const onStatusEditAndClose = async (
  item: LibraryItem,
  next: unknown,
  closeCallback: () => void,
) => {
  const value = statusEditValue(next);
  if (!value) return;
  const didUpdate = await onStatusEdit(item, value);
  closeCallback();
  if (didUpdate && (value === 'reading' || value === 'completed')) {
    openReadDatePrompt(item, value);
  }
};

const onVisibilityEditAndClose = async (
  item: LibraryItem,
  next: unknown,
  closeCallback: () => void,
) => {
  if (!visibilityEditValue(next)) return;
  await onVisibilityEdit(item, next);
  closeCallback();
};

const dateStartIso = (value: Date) =>
  new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0).toISOString();

const dateEndIso = (value: Date) =>
  new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999).toISOString();

const readDateRangeModel = (entry: ReadDateEntry): Date[] | null => {
  const dates = [entry.startedAt, entry.endedAt].filter(
    (value): value is Date => value instanceof Date,
  );
  return dates.length ? dates : null;
};

const buildReadDateEntry = (): ReadDateEntry => ({
  key: `entry-${readDateEntrySequence++}`,
  startedAt: null,
  endedAt: null,
});

const addPreviousReadEntry = () => {
  previousReadEntries.value.push(buildReadDateEntry());
};

const removePreviousReadEntry = (key: string) => {
  const index = previousReadEntries.value.findIndex((entry) => entry.key === key);
  if (index < 0) return;
  previousReadEntries.value.splice(index, 1);
};

const addCompletedReadEntry = () => {
  completedReadEntries.value.push(buildReadDateEntry());
};

const removeCompletedReadEntry = (key: string) => {
  if (completedReadEntries.value.length <= 1) return;
  const index = completedReadEntries.value.findIndex((entry) => entry.key === key);
  if (index < 0) return;
  completedReadEntries.value.splice(index, 1);
};

const openReadDatePrompt = (item: LibraryItem, status: LibraryItemStatus) => {
  readDateTargetItem.value = item;
  readDateDialogStatus.value = status;
  readingCurrentStartDate.value = status === 'reading' ? new Date() : null;
  previousReadEntries.value = [];
  completedReadEntries.value =
    status === 'completed'
      ? [{ key: buildReadDateEntry().key, startedAt: new Date(), endedAt: new Date() }]
      : [];
  readDateFormError.value = '';
  readDateDialogOpen.value = true;
};

const closeReadDatePrompt = (force = false) => {
  if (readDateSaving.value && !force) return;
  readDateDialogOpen.value = false;
  readDateDialogStatus.value = null;
  readDateTargetItem.value = null;
  readingCurrentStartDate.value = null;
  previousReadEntries.value = [];
  completedReadEntries.value = [];
  readDateFormError.value = '';
};

const validatedReadDatePayloads = () => {
  const status = readDateDialogStatus.value;
  if (!status) return null;

  if (status === 'reading') {
    if (!readingCurrentStartDate.value) {
      readDateFormError.value = 'Add a start date for your current read.';
      return null;
    }
    const payloads: Array<{ started_at: string; ended_at?: string }> = [
      { started_at: dateStartIso(readingCurrentStartDate.value) },
    ];
    for (const entry of previousReadEntries.value) {
      if (!entry.startedAt || !entry.endedAt) {
        readDateFormError.value = 'Each previous read needs both a start and finish date.';
        return null;
      }
      if (entry.endedAt < entry.startedAt) {
        readDateFormError.value = 'Finish dates must be the same as or after start dates.';
        return null;
      }
      payloads.push({
        started_at: dateStartIso(entry.startedAt),
        ended_at: dateEndIso(entry.endedAt),
      });
    }
    return payloads;
  }

  if (completedReadEntries.value.length === 0) {
    readDateFormError.value = 'Add at least one completed read.';
    return null;
  }
  const payloads: Array<{ started_at: string; ended_at?: string }> = [];
  for (const entry of completedReadEntries.value) {
    if (!entry.startedAt || !entry.endedAt) {
      readDateFormError.value = 'Each completed read needs both a start and finish date.';
      return null;
    }
    if (entry.endedAt < entry.startedAt) {
      readDateFormError.value = 'Finish dates must be the same as or after start dates.';
      return null;
    }
    payloads.push({
      started_at: dateStartIso(entry.startedAt),
      ended_at: dateEndIso(entry.endedAt),
    });
  }
  return payloads;
};

const saveReadDatePrompt = async (quickToday = false) => {
  if (readDateSaving.value) return;
  const item = readDateTargetItem.value;
  const status = readDateDialogStatus.value;
  if (!item || !status) return;
  if (isItemReadDateUpdating(item.id)) return;

  if (quickToday) {
    const today = new Date();
    if (status === 'reading') {
      readingCurrentStartDate.value = today;
    } else if (completedReadEntries.value.length === 0) {
      completedReadEntries.value = [
        { key: buildReadDateEntry().key, startedAt: today, endedAt: today },
      ];
    } else {
      completedReadEntries.value = completedReadEntries.value.map((entry, index) =>
        index === 0 ? { ...entry, startedAt: today, endedAt: today } : entry,
      );
    }
  }

  readDateFormError.value = '';
  const payloads = validatedReadDatePayloads();
  if (!payloads) return;

  readDateSaving.value = true;
  setItemReadDateUpdating(item.id, true);
  try {
    await Promise.all(
      payloads.map((body) =>
        apiRequest(`/api/v1/library/items/${item.id}/sessions`, {
          method: 'POST',
          body,
        }),
      ),
    );
    const latestStarted = payloads.reduce(
      (latest, body) => (body.started_at > latest ? body.started_at : latest),
      payloads[0]?.started_at ?? '',
    );
    if (latestStarted) item.last_read_at = latestStarted;
    toast.add({
      severity: 'success',
      summary:
        status === 'completed'
          ? `Saved ${payloads.length} completed read${payloads.length === 1 ? '' : 's'}.`
          : 'Reading dates saved.',
      life: 2200,
    });
    closeReadDatePrompt(true);
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) {
      toast.add({
        severity: 'info',
        summary: 'This item was already removed. Refreshing...',
        life: 3000,
      });
      closeReadDatePrompt(true);
      await fetchPage();
    } else {
      const msg = err instanceof ApiClientError ? err.message : 'Unable to save reading date.';
      toast.add({ severity: 'error', summary: msg, life: 3000 });
    }
  } finally {
    setItemReadDateUpdating(item.id, false);
    readDateSaving.value = false;
  }
};

const fetchPage = async () => {
  error.value = '';
  loading.value = true;

  try {
    const payload = await apiRequest<{
      items: LibraryItem[];
      pagination?: LibraryPagination;
      next_cursor?: string | null;
    }>('/api/v1/library/items', {
      query: {
        page: page.value,
        page_size: pageSize.value,
        sort: sortMode.value,
        status: statusFilter.value || undefined,
        visibility: visibilityFilter.value || undefined,
        tag: tagFilter.value.trim() || undefined,
      },
    });

    const pagination: LibraryPagination = payload.pagination ?? {
      page: page.value,
      page_size: pageSize.value,
      total_count: payload.items.length,
      total_pages: payload.items.length > 0 ? page.value : 0,
      from: payload.items.length > 0 ? (page.value - 1) * pageSize.value + 1 : 0,
      to: (page.value - 1) * pageSize.value + payload.items.length,
      has_prev: page.value > 1,
      has_next: Boolean(payload.next_cursor),
    };

    if (pagination.total_pages > 0 && page.value > pagination.total_pages) {
      page.value = pagination.total_pages;
      await fetchPage();
      return;
    }

    items.value = payload.items;
    totalCount.value = pagination.total_count;
    totalPages.value = pagination.total_pages;
    pageFrom.value = pagination.from;
    pageTo.value = pagination.to;
  } catch (err) {
    if (err instanceof ApiClientError) {
      error.value = err.message;
    } else {
      error.value = 'Unable to load library items right now.';
    }
  } finally {
    loading.value = false;
  }
};

const openRemoveConfirm = (item: LibraryItem) => {
  pendingRemoveItem.value = item;
  removeConfirmOpen.value = true;
};

const cancelRemoveConfirm = () => {
  if (removeConfirmLoading.value) return;
  removeConfirmOpen.value = false;
  pendingRemoveItem.value = null;
};

const confirmRemove = async () => {
  if (!pendingRemoveItem.value) return;
  removeConfirmLoading.value = true;
  try {
    await apiRequest(`/api/v1/library/items/${pendingRemoveItem.value.id}`, { method: 'DELETE' });

    items.value = items.value.filter((i) => i.id !== pendingRemoveItem.value?.id);
    toast.add({ severity: 'success', summary: 'Removed from your library.', life: 2500 });

    removeConfirmOpen.value = false;
    pendingRemoveItem.value = null;

    if (items.value.length === 0 && page.value > 1) {
      page.value -= 1;
    }
    await fetchPage();
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) {
      toast.add({
        severity: 'info',
        summary: 'This item was already removed. Refreshing...',
        life: 3000,
      });
      removeConfirmOpen.value = false;
      pendingRemoveItem.value = null;
      await fetchPage();
    } else {
      const msg =
        err instanceof ApiClientError ? err.message : 'Unable to remove this item right now.';
      toast.add({ severity: 'error', summary: msg, life: 3000 });
    }
  } finally {
    removeConfirmLoading.value = false;
  }
};

const resetToFirstPageAndFetch = () => {
  page.value = 1;
  void fetchPage();
};

const onPageChange = (event: { page: number; rows: number }) => {
  const nextPage = event.page + 1;
  const nextRows = event.rows;
  if (nextPage === page.value && nextRows === pageSize.value) return;
  page.value = nextPage;
  pageSize.value = nextRows;
  void fetchPage();
};

watch([statusFilter, visibilityFilter, sortMode], () => {
  resetToFirstPageAndFetch();
});

watch(tagFilter, () => {
  if (tagFilterDebounceTimer.value !== null) {
    window.clearTimeout(tagFilterDebounceTimer.value);
  }
  tagFilterDebounceTimer.value = window.setTimeout(() => {
    resetToFirstPageAndFetch();
    tagFilterDebounceTimer.value = null;
  }, 300);
});

watch(viewMode, (next) => {
  writeStoredViewMode(next);
});

watch(tableColumns, (next) => {
  writeStoredTableColumns(next);
});

const onLibraryUpdated = () => {
  void fetchPage();
};

onMounted(() => {
  viewMode.value = readStoredViewMode();
  tableColumns.value = readStoredTableColumns();
  window.addEventListener(LIBRARY_UPDATED_EVENT, onLibraryUpdated);
  void fetchPage();
});

onBeforeUnmount(() => {
  if (tagFilterDebounceTimer.value !== null) {
    window.clearTimeout(tagFilterDebounceTimer.value);
    tagFilterDebounceTimer.value = null;
  }
  window.removeEventListener(LIBRARY_UPDATED_EVENT, onLibraryUpdated);
});
</script>

<style scoped>
.library-table :deep(.p-datatable-thead > tr > th) {
  text-align: center;
  vertical-align: middle;
}

.library-table :deep(.p-datatable-thead > tr > th .p-column-header-content) {
  align-items: center;
  justify-content: center;
}

.library-table :deep(.p-datatable-thead > tr > th .p-datatable-column-header-content) {
  align-items: center;
  justify-content: center;
}

.library-table :deep(tbody > tr > td) {
  vertical-align: middle;
}

.library-sort-trigger {
  display: inline-flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border: 0;
  background: transparent;
  padding: 0;
  font-family: 'Avenir Next', Avenir, 'Atkinson Hyperlegible', ui-sans-serif, system-ui, sans-serif;
  font-size: inherit;
  font-style: inherit;
  letter-spacing: inherit;
  color: inherit;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
}

.library-header-label {
  display: inline-flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  font-family: 'Avenir Next', Avenir, 'Atkinson Hyperlegible', ui-sans-serif, system-ui, sans-serif;
  font-size: inherit;
  font-style: inherit;
  letter-spacing: inherit;
  font-weight: 600;
  line-height: 1.2;
}

.library-description :deep(strong) {
  color: var(--p-text-color);
  font-weight: 600;
}

.library-description :deep(a) {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px dotted currentColor;
}

.library-description :deep(a:hover),
.library-description :deep(a:focus-visible) {
  border-bottom-style: solid;
}

.library-description :deep(code) {
  border-radius: 0.25rem;
  padding: 0.05rem 0.3rem;
  background: color-mix(in oklab, var(--p-content-border-color) 35%, transparent);
  font-size: 0.92em;
}
</style>

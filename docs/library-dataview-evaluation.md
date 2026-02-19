# Library DataView Evaluation (Issue #174)

Reviewed on February 19, 2026.

## Scope

This evaluation compares the current Library rendering implementation against PrimeReact `DataView` and provides a recommendation. This issue does not implement UI migration.

## Current implementation map

Primary implementation file:
- `/Users/ryan/Developer/chapterverse/apps/web/src/app/(app)/library/library-page-client.tsx`

Key boundaries in current code:
- View mode type and persistence (`list | grid | table`): line 68, lines 514-638
- Server-coupled query/pagination state (`page`, `pageSize`, `sort`, filters): lines 633-636, lines 1244-1287
- Context menu model and triggers (click, right-click, keyboard): lines 1177-1233
- Shared view toggle control: lines 2293-2301
- Table rendering path (`DataTable`): lines 2429-2772
- List rendering path (custom card layout): lines 2774-2908
- Grid rendering path (custom card layout): lines 2910-3069
- Pagination (`Paginator`) wiring: lines 3091-3104

Existing parity-focused tests:
- `/Users/ryan/Developer/chapterverse/apps/web/src/tests/unit/library-context-menu.test.tsx`
- `/Users/ryan/Developer/chapterverse/apps/web/src/tests/unit/app-route-server-prefetch.test.tsx`

## Evaluation criteria matrix

| Criterion | Current custom implementation | PrimeReact DataView fit | Result |
| --- | --- | --- | --- |
| Rendering modes coverage (`list`, `grid`, `table`) | Full support via explicit branches | `DataView` targets list/grid patterns; table behavior is a separate concern (typically `DataTable`) | Fail for full replacement |
| Pagination compatibility with server paging | Explicit `Paginator` state integration with API query (`page`, `page_size`) | Compatible in principle; still requires explicit server-state handling | Partial |
| Context menu + actions parity (click/right-click/keyboard) | Fully custom and shared across all 3 modes | Possible in templates, but still fully custom wiring inside item templates | Partial |
| Sort/filter interaction parity | Table sort triggers + global filters are tightly coupled to API fetch/sorting behavior | List/grid templates do not reduce sort/filter state complexity by themselves | Partial |
| Accessibility/keyboard behavior parity | Keyboard context menu trigger implemented explicitly (`Shift+F10` / `ContextMenu`) | Possible but not materially simplified | Partial |
| Complexity/maintainability delta | Current complexity is in behavior coupling, not only markup duplication | Migrating only list/grid to `DataView` introduces an additional abstraction while keeping table branch and behavior wiring | Negative |
| Test impact/maintenance | Existing tests target stable selectors and behavior contracts | Migration would require selector/test adaptation with limited complexity payoff | Negative |

## Capability mapping to official docs

Official sources reviewed:
- PrimeReact DataView: [https://primereact.org/dataview/](https://primereact.org/dataview/)
- PrimeReact DataTable: [https://primereact.org/datatable/](https://primereact.org/datatable/)
- PrimeReact Paginator: [https://primereact.org/paginator/](https://primereact.org/paginator/)

Observed fit:
- Direct fit:
  - `DataView` supports list/grid item templating and layout switching.
  - Works with external paginator state and server-driven data arrays.
- Gaps for this surface:
  - No table-mode equivalent in `DataView`; table-mode remains `DataTable` behavior.
  - Current library experience depends on cross-mode shared interaction logic (context menu, workflow entry points, keyboard triggers) that remains custom regardless of list/grid wrapper.
  - Current sort/filter/query interactions are tied to API state and are not reduced by changing list/grid container components.

## Decision rules

Issue rule:
- `MIGRATE` only if complexity is reduced materially while preserving parity and avoiding dual-path logic debt.
- Otherwise `KEEP_CUSTOM`.

Scoring:
- Mandatory criterion not satisfied: full-mode coverage (`table` cannot be replaced by `DataView`).
- Net complexity reduction not demonstrated: behavior coupling remains and parallel rendering abstractions increase.

## Recommendation

**Recommendation: `KEEP_CUSTOM` for Issue #174.**

Rationale:
- A `DataView` migration would only affect list/grid wrappers while leaving the highest-complexity behavior unchanged.
- Table mode would still require a separate `DataTable` path, preserving multi-path rendering complexity.
- Expected maintenance gains are not strong enough to justify migration risk and test churn for this iteration.

## Follow-up blueprint (no implementation in this issue)

Targeted refactor path without `DataView`:
1. Extract shared card primitives used by both list and grid:
   - Cover block
   - Status/visibility/rating/recommendation cluster
   - Action buttons/context trigger
2. Extract shared handlers into focused hooks/helpers:
   - Context menu trigger utilities
   - Item action handlers (remove/update/workflow open)
3. Keep selector contract stable:
   - Preserve `data-test` keys used by unit tests unless deliberately migrated in a dedicated test update PR.
4. Incrementally reduce duplication with no behavior change:
   - Refactor list + grid branches first
   - Leave table branch intact
5. Re-run and expand parity tests as needed around:
   - view switching
   - context menu across input methods
   - paginator behavior

## Parity checklist (status)

- [x] View-mode parity requirements documented (`list`, `grid`, `table`)
- [x] Pagination behavior requirements documented
- [x] Context menu/action parity requirements documented
- [x] Accessibility/keyboard trigger requirements documented
- [x] Complexity and maintainability tradeoffs documented
- [x] Recommendation with explicit decision rule documented

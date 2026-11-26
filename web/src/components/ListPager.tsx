export const LIST_PAGE_SIZE = 50;

// "1-50 of 143", Previous, page numbers, Next.
export function ListPager({ total, page, onPage }: { total: number; page: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  const first = total === 0 ? 0 : page * LIST_PAGE_SIZE + 1;
  const last = Math.min(total, (page + 1) * LIST_PAGE_SIZE);
  return (
    <nav aria-label="Pages" className="flex h-[52px] items-center gap-2 border-t bg-subtle px-4">
      <span className="flex-1 text-sm" data-testid="pager-info">{first}-{last} of {total}</span>
      <button type="button" className="btn btn-sm" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</button>
      {Array.from({ length: pages }, (_, index) => (
        <button key={index} type="button" className={`btn btn-sm min-w-8 px-2 ${index === page ? "btn-p" : ""}`} aria-label={`Page ${index + 1}`}
          aria-current={index === page ? "page" : undefined} onClick={() => onPage(index)}>
          {index + 1}
        </button>
      ))}
      <button type="button" className="btn btn-sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Next</button>
    </nav>
  );
}

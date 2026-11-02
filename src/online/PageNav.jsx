import React, { useEffect } from 'react';
export function PageNav({ page, count, size, setPage }) {
  const pages = Math.max(1, Math.ceil(count / size));
  useEffect(() => {
    if (page >= pages) setPage(pages - 1);
  }, [page, pages, setPage]);
  // 1ページで収まるなら出さない（「1 / 1」と押せない矢印だけが並んでいた）
  if (pages <= 1) return null;
  return (
    <div className="online-pager">
      <button
        aria-label="前のページ"
        disabled={page <= 0}
        onClick={() => setPage(page - 1)}
      >
        ←
      </button>
      <span>
        {Math.min(page + 1, pages)} / {pages}
      </span>
      <button
        aria-label="次のページ"
        disabled={page >= pages - 1}
        onClick={() => setPage(page + 1)}
      >
        →
      </button>
    </div>
  );
}

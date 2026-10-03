import { useEffect } from 'react';

// 窄畫面（手機、LINE 內開的後台頁）把 antd Table 的每一列排成卡片：每個欄位一行，左邊欄名、右邊值，
// 不用左右滑。實際的排法在 theme/slowlife.css 的 .sl-table-cards（只在內容區或視窗夠窄時生效）；
// 這裡只負責把表頭文字標到每一格的 data-label 上，並替適合的表格加上 class。
// 所有頁面共用，不用逐頁改。多層表頭與樹狀表格維持原本的表格（排成卡片會看不懂）。

const CARD_CLASS = 'sl-table-cards';

const ownedBy = (el: Element, antTable: Element) => el.closest('.ant-table') === antTable;

const labelTable = (antTable: Element) => {
  const wrapper = antTable.closest('.ant-table-wrapper');
  if (!wrapper) return;
  const theads = Array.from(antTable.querySelectorAll('thead.ant-table-thead')).filter((t) => ownedBy(t, antTable));
  const bodies = Array.from(antTable.querySelectorAll('tbody.ant-table-tbody')).filter((b) => ownedBy(b, antTable));
  const thead = theads[0] as HTMLTableSectionElement | undefined;
  const tbody = bodies[0] as HTMLTableSectionElement | undefined;
  const nested = antTable.querySelector('.ant-table-row-level-1'); // 樹狀資料（例如權限矩陣）
  if (!thead || !tbody || thead.rows.length !== 1 || nested) {
    wrapper.classList.remove(CARD_CLASS);
    return;
  }

  const labels: string[] = [];
  for (const th of Array.from(thead.rows[0].cells)) {
    const text = (th.textContent || '').trim();
    for (let i = 0; i < th.colSpan; i++) labels.push(text);
  }

  for (const row of Array.from(tbody.rows)) {
    if (!row.classList.contains('ant-table-row')) continue;
    let column = 0;
    for (const cell of Array.from(row.cells)) {
      const label = cell.colSpan === 1 ? labels[column] || '' : '';
      if (cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label);
      column += cell.colSpan;
    }
  }
  wrapper.classList.add(CARD_CLASS);
};

const labelAll = () => {
  document.querySelectorAll('.ant-table').forEach(labelTable);
};

/** 在員工後台的版面掛一次：表格內容變動（換頁、篩選、資料載入、開彈窗）時重新標註。 */
export const useResponsiveTables = () => {
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        labelAll();
      });
    };
    schedule();
    // 只看節點增減（不看屬性），自己設定 data-label／class 不會再觸發
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
};

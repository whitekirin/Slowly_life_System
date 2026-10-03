import { useEffect, useState } from 'react';

// 依視窗寬度算出一個值；只有「算出來的值」改變時才觸發重繪（resize 以 requestAnimationFrame 節流），
// 所以拖拉視窗時整個 App 不會每一幀都重新 render。select 必須回傳原始型別（number/string/boolean）。
export function useViewport<T extends number | string | boolean>(select: (width: number) => T): T {
  const [value, setValue] = useState<T>(() => select(typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setValue(select(window.innerWidth)));
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return value;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * 依視窗寬度決定整套 UI 的基準字級（px）。所有元件尺寸都從這個數字等比例推出。
 * 手機固定 14 以保可讀性；桌面 1024→13、1440→14、1920→15、2560→16，最大 17。
 */
export function fluidFontSize(width: number): number {
  if (width < 768) return 14;
  return Math.round(clamp(14 + (width - 1440) / 560, 13, 17));
}

/** 側欄寬度：約佔視窗 15%，介於 208～280px（取 4 的倍數，減少重繪次數） */
export function fluidSiderWidth(width: number): number {
  return Math.round(clamp(width * 0.15, 208, 280) / 4) * 4;
}

import { useCallback, useState } from "react";

function readList<T>(key: string): { items: T[]; warning: string } {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { items: [], warning: "" };
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? { items: parsed as T[], warning: "" } : { items: [], warning: "Dữ liệu đã lưu không đúng định dạng." };
  } catch {
    return { items: [], warning: "Không thể đọc bộ nhớ trình duyệt. Dữ liệu mới chỉ được giữ trong phiên này." };
  }
}

export function useLocalStorageList<T>(key: string) {
  const initial = readList<T>(key);
  const [items, setItems] = useState<T[]>(initial.items);
  const [warning, setWarning] = useState(initial.warning);

  const update = useCallback((updater: (current: T[]) => T[]) => {
    setItems((current) => {
      const next = updater(current);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
        setWarning("");
      } catch {
        setWarning("Không thể lưu lâu dài. Dữ liệu chỉ được giữ đến khi bạn đóng trang.");
      }
      return next;
    });
  }, [key]);

  return { items, update, warning };
}

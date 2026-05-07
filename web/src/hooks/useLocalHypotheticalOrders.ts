import { UnitOrderInput } from '@/diplomacy/gameHelpers';
import { useState, useCallback, useEffect, Dispatch, SetStateAction } from 'react';

export interface LocalHypotheticalScenario {
  id: string;
  label: string;
  orders: Record<string, UnitOrderInput>;
}

const STORAGE_KEY_PREFIX = 'hypothetical-orders';

function getStorageKey(powerId: string): string {
  return `${STORAGE_KEY_PREFIX}-${powerId}`;
}

function createDefaultScenarios(): LocalHypotheticalScenario[] {
  return [1, 2, 3].map((n) => ({
    id: `local-hyp-${n}-${Date.now()}`,
    label: `パターン ${n}`,
    orders: {},
  }));
}

export function useLocalHypotheticalOrders(powerId: string) {
  const [scenarios, setScenarios] = useState<LocalHypotheticalScenario[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  // localStorage から初期化
  useEffect(() => {
    const key = getStorageKey(powerId);
    const stored = localStorage.getItem(key);

    if (stored) {
      try {
        const data = JSON.parse(stored) as {
          scenarios: LocalHypotheticalScenario[];
          activeIndex: number;
        };
        setScenarios(data.scenarios);
        setActiveIndex(data.activeIndex);
      } catch {
        // JSON parse error → デフォルトを使う
        setScenarios(createDefaultScenarios());
        setActiveIndex(0);
      }
    } else {
      // 初回 → デフォルト作成
      setScenarios(createDefaultScenarios());
      setActiveIndex(0);
    }

    setIsLoaded(true);
  }, [powerId]);

  // scenarios/activeIndex が変わったら localStorage に保存
  useEffect(() => {
    if (!isLoaded) return; // 初期化中は保存しない

    const key = getStorageKey(powerId);
    localStorage.setItem(
      key,
      JSON.stringify({ scenarios, activeIndex })
    );
  }, [scenarios, activeIndex, isLoaded, powerId]);

  const selectScenario = useCallback((index: number) => {
    setActiveIndex(Math.max(0, Math.min(index, scenarios.length - 1)));
  }, [scenarios.length]);

  const addScenario = useCallback(() => {
    setScenarios((prev) => {
      const nextNum = prev.length + 1;
      return [
        ...prev,
        {
          id: `local-hyp-${nextNum}-${Date.now()}`,
          label: `パターン ${nextNum}`,
          orders: {},
        },
      ];
    });
  }, []);

  const updateOrders = useCallback((action: ((prev: Record<string, UnitOrderInput>) => Record<string, UnitOrderInput>) | Record<string, UnitOrderInput>) => {
    setScenarios((prev) => {
      const scenario = prev[activeIndex];
      if (!scenario) return prev;

      const nextOrders = typeof action === 'function' ? action(scenario.orders) : action;
      const newScenarios = prev.slice();
      newScenarios[activeIndex] = { ...scenario, orders: nextOrders };
      return newScenarios;
    });
  }, [activeIndex]);

  return {
    scenarios,
    activeIndex,
    isLoaded,
    activeScenario: scenarios[activeIndex] ?? null,
    selectScenario,
    addScenario,
    updateOrders: updateOrders as Dispatch<SetStateAction<Record<string, UnitOrderInput>>>,
  };
}

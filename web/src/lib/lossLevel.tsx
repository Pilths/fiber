import type { components } from "@/api/schema";

type Level = NonNullable<components["schemas"]["CoreLoss"]["level"]>;

// Measured loss against calculated (PRD): green up to 3%, amber 3-7%, red 7-10%, off-scale above 10%.
// Symbol and word with the colour, never colour alone.
const LOSS_LEVEL: Record<Level, { symbol: string; word: string; tone: string }> = {
  green: { symbol: "●", word: "Normal", tone: "text-green" },
  amber: { symbol: "▲", word: "Warning", tone: "text-amber" },
  red: { symbol: "◆", word: "High", tone: "font-semibold text-red" },
  off_scale: { symbol: "✕", word: "Off-scale", tone: "font-semibold text-red" },
};

// "+4.2%" or "-1.0%".
function deviationText(percent: number) {
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(1)}%`;
}

type LossDeviationProps = {
  loss: { deviation_pct: number | null; level: Level | null };
  compact?: boolean;
};

// Deviation and level of one core's measured loss, e.g. "+4.2% ▲ Warning". Nothing when there is no level.
// Compact (narrow table cells) keeps the symbol and moves the word to a tooltip and screen readers.
export function LossDeviation({ loss, compact = false }: LossDeviationProps) {
  if (loss.level == null || loss.deviation_pct == null) {
    return null;
  }
  const level = LOSS_LEVEL[loss.level];
  return (
    <span className={`whitespace-nowrap ${level.tone}`} title={compact ? level.word : undefined}>
      {deviationText(loss.deviation_pct)} <span aria-hidden>{level.symbol}</span>
      <span className={compact ? "sr-only" : ""}> {level.word}</span>
    </span>
  );
}

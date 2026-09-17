"use client";

import { use, useEffect, useState } from "react";
import { useSession } from "@/lib/use-session";
import { FetchJsonError } from "@/lib/fetch-json";
import { fetchEventOverviewFresh } from "@/lib/use-event-overview";
import { defaultRulesForStage, parseRulesContent, type RulesContentStage } from "@/lib/rules-content";
import { TeamNav } from "../team-nav";
import { PageFrame } from "@/components/theme/PageFrame";

const STAGE_LABELS: Record<string, string> = {
  setup: "Setup",
  lobby: "Lobby",
  stage_1: "Stage 1",
  stage_2: "Stage 2",
  stage_3: "Stage 3",
  scoring: "Scoring",
  completed: "Completed",
};

// Section 7.1 "Rules" — same wooden-frame + rules/heading.png banner as
// the legacy rules page. Every bullet is either an admin's own edited
// line (event_settings.rules_content) or, absent that, the original
// auto-generated text computed live from event_settings — see
// defaultRulesForStage above.
export default function RulesPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { status } = useSession();
  const [overview, setOverview] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated") {
      fetchEventOverviewFresh(eventId)
        .then(setOverview)
        .catch((err) => setLoadError(err instanceof FetchJsonError ? err.message : "Couldn't load the rules. Retrying…"));
    }
  }, [eventId, status]);

  if (loadError && !overview) return <PageFrame><p className="text-red-100 bg-red-950/80 px-3 py-2 rounded-md font-medium text-center mt-8">{loadError}</p></PageFrame>;
  if (!overview) return <PageFrame><p className="text-[#F1EBB5]">Loading…</p></PageFrame>;
  const s = overview.settings;
  const customContent = parseRulesContent(s.rulesContent);
  const linesFor = (stage: RulesContentStage) => customContent[stage] ?? defaultRulesForStage(stage, s);

  return (
    <PageFrame>
      <TeamNav eventId={eventId} />
      <div className="text-center mb-6 w-full max-w-sm">
        <img src="/assets/images/rules/heading.png" alt="Rules" className="w-full h-auto object-contain" />
      </div>

      <div className="w-full max-w-3xl p-4 md:p-6 overflow-y-auto text-yellow-100 text-sm md:text-base leading-relaxed bg-[#3b2a1a]/70 rounded-lg">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <p className="text-yellow-300">
            Rulebook version: {overview.event.rulesVersion} · Current stage:{" "}
            <strong>{STAGE_LABELS[overview.event.status] ?? overview.event.status}</strong>
          </p>
          {overview.isStaff && (
            <a
              href={`/events/${eventId}/moderator/setup#rules-settings`}
              className="px-3 py-1.5 rounded text-sm bg-[#463d36] text-[#F1EBB5] hover:bg-[#62574e] shadow whitespace-nowrap"
            >
              Edit these rules
            </a>
          )}
        </div>

        {s.customRulesNote && (
          <div className="mb-4 p-3 bg-yellow-900/40 border border-yellow-700 rounded whitespace-pre-wrap">{s.customRulesNote}</div>
        )}

        <h2 className="text-yellow-300 font-bold text-lg mb-2">Stage 1: Material Auction</h2>
        <ul className="list-disc list-inside mb-4">
          {linesFor("stage1").map((line, i) => <li key={i}>{line}</li>)}
        </ul>

        <h2 className="text-yellow-300 font-bold text-lg mb-2">Stage 2: Trade and Build</h2>
        <ul className="list-disc list-inside mb-4">
          {linesFor("stage2").map((line, i) => <li key={i}>{line}</li>)}
        </ul>

        <h2 className="text-yellow-300 font-bold text-lg mb-2">Stage 3: City Auction</h2>
        <ul className="list-disc list-inside mb-4">
          {linesFor("stage3").map((line, i) => <li key={i}>{line}</li>)}
        </ul>

        <h2 className="text-yellow-300 font-bold text-lg mb-2">Tiebreakers</h2>
        <ol className="list-decimal list-inside">
          {linesFor("tiebreakers").map((line, i) => <li key={i}>{line}</li>)}
        </ol>
      </div>
    </PageFrame>
  );
}

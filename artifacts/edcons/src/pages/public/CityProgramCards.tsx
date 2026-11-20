import { lazy, Suspense, useState } from "react";
import { useI18n } from "@/hooks/use-i18n";
import { PublicProgramCard } from "./PublicProgramCard";
import type { PublicProgramCardData } from "./PublicProgramCard";
import { PublicProgramProposalActions } from "./PublicProgramProposalActions";
import type { PublicProgramDetailData } from "./PublicProgramDetailDialog";
import { DetailPrice } from "./DetailEditorial";
import { displayTuition, splitRequirements, type DetailTuition } from "./detailPresentation";

const PublicProgramDetailDialog = lazy(() => import("./PublicProgramDetailDialog")
  .then(module => ({ default: module.PublicProgramDetailDialog })));
const PublicProgramApplicationDialog = lazy(() => import("./PublicProgramApplicationDialog"));

/** Additive city API fields may be absent while an older response is cached. */
export type CityProgramCardData = Omit<PublicProgramDetailData, "universityPath"> & {
  universityPath?: string | null;
  universityId?: number;
  isActive?: boolean;
  universityIsActive?: boolean;
  tuition?: DetailTuition | null;
};

/** The city's existing bounded programme sample, using the public catalogue UI. */
export function CityProgramCards({ programs }: { programs: CityProgramCardData[] }) {
  const { t, lang } = useI18n();
  const [selected, setSelected] = useState<CityProgramCardData | null>(null);
  const [applyProgram, setApplyProgram] = useState<CityProgramCardData | null>(null);
  const [proposalPrograms, setProposalPrograms] = useState<Map<number, CityProgramCardData>>(() => new Map());
  const price = (program: CityProgramCardData) => <div className="university-program-tuition">
    <p className="text-[10px] text-muted-foreground mb-1.5">{t("courseFinderPage.tuitionFee")}</p>
    <DetailPrice tuition={displayTuition({ ...program, tuition: program.tuition ?? null }, lang)} locale={lang} verifiedLabel={t("catalogDetail.verifiedPrice")} />
  </div>;
  return <div className="city-program-cards">
    {programs.length ? <div className="mb-5 flex justify-end"><PublicProgramProposalActions results={programs.map(program => ({ ...program, universityPath: program.universityPath ?? "" }))} selected={proposalPrograms as ReadonlyMap<number, PublicProgramCardData>} /></div> : null}
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">{programs.map((program, index) => <PublicProgramCard
      key={program.id} index={index} program={{ ...program, universityPath: program.universityPath ?? "" }}
      selectedForProposal={proposalPrograms.has(program.id)} onToggleProposalSelection={() => setProposalPrograms(current => { const next = new Map(current); next.has(program.id) ? next.delete(program.id) : next.set(program.id, program); return next; })}
      onDetails={() => setSelected({ ...program, requirements: splitRequirements(program.requirements, { canonicalPath: program.canonicalPath, id: program.id }).requirements.join("\n") })}
      onApply={() => setApplyProgram(program)}
      applyDisabled={program.isActive !== true || program.universityIsActive !== true}
      omitLegacyTiming tuitionContent={price(program)} />)}</div>
    {selected ? <Suspense fallback={null}>
      <PublicProgramDetailDialog open onClose={() => setSelected(null)}
        program={{ ...selected, universityPath: selected.universityPath ?? "" }}
        omitLegacyTiming tuitionContent={price(selected)} />
    </Suspense> : null}
    {applyProgram ? <Suspense fallback={null}>
      <PublicProgramApplicationDialog open onClose={() => setApplyProgram(null)} program={applyProgram} />
    </Suspense> : null}
  </div>;
}

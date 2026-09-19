import { useState } from "react";
import { useI18n } from "@/hooks/use-i18n";
import { PublicProgramCard } from "./PublicProgramCard";
import { PublicProgramDetailDialog, type PublicProgramDetailData } from "./PublicProgramDetailDialog";
import { DetailPrice } from "./DetailEditorial";
import { displayTuition, splitRequirements, type DetailTuition } from "./detailPresentation";

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
  const { t, lang, localePath } = useI18n();
  const [selected, setSelected] = useState<CityProgramCardData | null>(null);
  const price = (program: CityProgramCardData) => <div className="university-program-tuition">
    <p className="text-[10px] text-muted-foreground mb-1.5">{t("courseFinderPage.tuitionFee")}</p>
    <DetailPrice tuition={displayTuition({ ...program, tuition: program.tuition ?? null }, lang)} locale={lang} verifiedLabel={t("catalogDetail.verifiedPrice")} />
  </div>;
  return <div className="city-program-cards">
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">{programs.map((program, index) => <PublicProgramCard
      key={program.id} index={index} program={{ ...program, universityPath: program.universityPath ?? "" }}
      onDetails={() => setSelected({ ...program, requirements: splitRequirements(program.requirements, { canonicalPath: program.canonicalPath, id: program.id }).requirements.join("\n") })}
      applyHref={`${localePath("/programs")}?programId=${program.id}`}
      applyDisabled={program.isActive !== true || program.universityIsActive !== true}
      omitLegacyTiming tuitionContent={price(program)} />)}</div>
    <PublicProgramDetailDialog open={!!selected} onClose={() => setSelected(null)}
      program={selected ? { ...selected, universityPath: selected.universityPath ?? "" } : null}
      omitLegacyTiming tuitionContent={selected ? price(selected) : null} />
  </div>;
}

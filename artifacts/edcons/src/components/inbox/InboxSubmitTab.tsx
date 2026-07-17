import { useState } from "react";
import { useCreateStudent, customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles, ArrowLeft } from "lucide-react";
import type { SubmitReadyData } from "./InboxStudentTab";

interface InboxSubmitTabProps {
  conversationId: number;
  data: SubmitReadyData;
  onCreated: () => void;
  onBack: () => void;
}

function AiTag({ field, aiFields }: { field: string; aiFields: Set<string> }) {
  if (!aiFields.has(field)) return null;
  return (
    <Sparkles className="w-3 h-3 text-violet-500 shrink-0 inline-block ms-1" />
  );
}

export function InboxSubmitTab({
  conversationId,
  data,
  onCreated,
  onBack,
}: InboxSubmitTabProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const createStudent = useCreateStudent();
  const [form, setForm] = useState(data.form);
  const [saving, setSaving] = useState(false);

  const isPhd =
    data.selectedLevel.toLowerCase().includes("phd") ||
    data.selectedLevel.toLowerCase().includes("doctor");
  const isHigher =
    data.selectedLevel.toLowerCase().includes("master") ||
    data.selectedLevel.toLowerCase().includes("phd") ||
    data.selectedLevel.toLowerCase().includes("doctor") ||
    data.selectedLevel.toLowerCase().includes("mba");

  async function handleCreate() {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast({
        title: t("inbox.studentTab.fillRequired"),
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const s1 = form.school1.trim();
      const s2 = form.school2.trim();
      const schoolInfo =
        isPhd && s2 ? [s1, s2].filter(Boolean).join(" | ") : s1 || null;

      const created = (await createStudent.mutateAsync({
        data: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          nationality: form.nationality.trim() || null,
          dateOfBirth: form.dateOfBirth.trim() || null,
          passportNumber: form.passportNumber.trim() || null,
          passportExpiry: form.passportExpiry.trim() || null,
          motherName: form.motherName.trim() || null,
          fatherName: form.fatherName.trim() || null,
          highSchool: schoolInfo,
          gpa: form.gpa.trim() || null,
          interestedLevel: data.selectedLevel || null,
          status: "active",
        } as any,
      })) as any;
      const studentId: number = created.id;

      await customFetch(
        `/api/inbox/conversations/${conversationId}/match`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "student", entityId: studentId }),
        }
      );

      let docsSaved = 0;
      for (const [docType, att] of Object.entries(data.staging)) {
        try {
          await customFetch(
            `/api/inbox/conversations/${conversationId}/messages/${att.msgId}/attachments/${att.attachIdx}/save-as-document`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ownerType: "student",
                ownerId: studentId,
                documentType: docType,
              }),
            }
          );
          docsSaved++;
        } catch {
        }
      }

      toast({
        title:
          docsSaved > 0
            ? t("inbox.studentTab.studentCreatedWithDocs", {
                count: String(docsSaved),
              })
            : t("inbox.studentTab.studentCreated"),
      });
      onCreated();
    } catch (err: any) {
      const msg = err?.data?.error || err?.body?.error || err?.message;
      toast({
        title: t("inbox.studentTab.createFailed"),
        description: typeof msg === "string" ? msg : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="p-0.5 rounded hover:bg-muted transition-colors"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </button>
        <span className="text-sm font-semibold">
          {t("inbox.studentTab.reviewTitle")}
        </span>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {data.aiFields.size > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded-md px-3 py-2">
            <Sparkles className="w-3 h-3 shrink-0" />
            {t("inbox.studentTab.aiExtracted", {
              count: String(data.aiFields.size),
            })}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs flex items-center">
              {t("apply.firstName")}
              <span className="text-destructive ms-0.5">*</span>
              <AiTag field="firstName" aiFields={data.aiFields} />
            </Label>
            <Input
              className="h-7 text-sm"
              value={form.firstName}
              onChange={(e) =>
                setForm((f) => ({ ...f, firstName: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs flex items-center">
              {t("apply.lastName")}
              <span className="text-destructive ms-0.5">*</span>
              <AiTag field="lastName" aiFields={data.aiFields} />
            </Label>
            <Input
              className="h-7 text-sm"
              value={form.lastName}
              onChange={(e) =>
                setForm((f) => ({ ...f, lastName: e.target.value }))
              }
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs flex items-center">
              {t("apply.email")}
              <AiTag field="email" aiFields={data.aiFields} />
            </Label>
            <Input
              className="h-7 text-sm"
              type="email"
              value={form.email}
              onChange={(e) =>
                setForm((f) => ({ ...f, email: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs flex items-center">
              {t("apply.phone")}
              <AiTag field="phone" aiFields={data.aiFields} />
            </Label>
            <Input
              className="h-7 text-sm"
              value={form.phone}
              onChange={(e) =>
                setForm((f) => ({ ...f, phone: e.target.value }))
              }
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs flex items-center">
              {t("apply.motherName")}
              <AiTag field="motherName" aiFields={data.aiFields} />
            </Label>
            <Input
              className="h-7 text-sm"
              value={form.motherName}
              onChange={(e) =>
                setForm((f) => ({ ...f, motherName: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs flex items-center">
              {t("apply.fatherName")}
              <AiTag field="fatherName" aiFields={data.aiFields} />
            </Label>
            <Input
              className="h-7 text-sm"
              value={form.fatherName}
              onChange={(e) =>
                setForm((f) => ({ ...f, fatherName: e.target.value }))
              }
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs flex items-center">
              {t("apply.nationality")}
              <AiTag field="nationality" aiFields={data.aiFields} />
            </Label>
            <Input
              className="h-7 text-sm"
              value={form.nationality}
              onChange={(e) =>
                setForm((f) => ({ ...f, nationality: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs flex items-center">
              {t("apply.dateOfBirth")}
              <AiTag field="dateOfBirth" aiFields={data.aiFields} />
            </Label>
            <Input
              className="h-7 text-sm"
              type="date"
              value={form.dateOfBirth}
              onChange={(e) =>
                setForm((f) => ({ ...f, dateOfBirth: e.target.value }))
              }
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs flex items-center">
              {t("apply.passportNumber")}
              <AiTag field="passportNumber" aiFields={data.aiFields} />
            </Label>
            <Input
              className="h-7 text-sm"
              value={form.passportNumber}
              onChange={(e) =>
                setForm((f) => ({ ...f, passportNumber: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs flex items-center">
              {t("apply.passportExpiryDate")}
              <AiTag field="passportExpiry" aiFields={data.aiFields} />
            </Label>
            <Input
              className="h-7 text-sm"
              type="date"
              value={form.passportExpiry}
              onChange={(e) =>
                setForm((f) => ({ ...f, passportExpiry: e.target.value }))
              }
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
            {t("inbox.studentTab.schoolInfo")}
          </div>
          <div className={`grid gap-2 ${isPhd ? "grid-cols-1" : "grid-cols-2"}`}>
            <div className="space-y-1">
              <Label className="text-xs flex items-center">
                {isHigher
                  ? t("inbox.studentTab.bachelorUni")
                  : t("inbox.studentTab.highSchool")}
                <AiTag field="highSchool" aiFields={data.aiFields} />
              </Label>
              <Input
                className="h-7 text-sm"
                placeholder={
                  isHigher
                    ? t("inbox.studentTab.bachelorUniPlaceholder")
                    : t("inbox.studentTab.highSchoolPlaceholder")
                }
                value={form.school1}
                onChange={(e) =>
                  setForm((f) => ({ ...f, school1: e.target.value }))
                }
              />
            </div>
            {isPhd && (
              <div className="space-y-1">
                <Label className="text-xs">
                  {t("inbox.studentTab.masterUni")}
                </Label>
                <Input
                  className="h-7 text-sm"
                  placeholder={t("inbox.studentTab.masterUniPlaceholder")}
                  value={form.school2}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, school2: e.target.value }))
                  }
                />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs flex items-center">
                {t("apply.gpa")}
                <AiTag field="gpa" aiFields={data.aiFields} />
              </Label>
              <Input
                className="h-7 text-sm"
                value={form.gpa}
                onChange={(e) =>
                  setForm((f) => ({ ...f, gpa: e.target.value }))
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t shrink-0 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onBack}
          disabled={saving}
          className="flex-1"
        >
          {t("inbox.studentTab.cancel")}
        </Button>
        <Button
          size="sm"
          onClick={() => void handleCreate()}
          disabled={saving || !form.firstName.trim() || !form.lastName.trim()}
          className="flex-1"
        >
          {saving && (
            <Loader2 className="w-3.5 h-3.5 animate-spin me-1.5" />
          )}
          {saving
            ? t("inbox.studentTab.creating")
            : t("inbox.studentTab.createBtn")}
        </Button>
      </div>
    </div>
  );
}

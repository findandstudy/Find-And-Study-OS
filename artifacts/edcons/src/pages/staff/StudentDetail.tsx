import { useLocation } from "wouter";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  useGetStudent,
  useListApplications,
  useListDocuments,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Mail, Phone, Globe, GraduationCap, FileText, User, Home, Calendar } from "lucide-react";

interface Props {
  id: number;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  inactive: "bg-gray-100 text-gray-600",
  graduated: "bg-blue-100 text-blue-700",
  suspended: "bg-red-100 text-red-700",
};

const STAGE_COLORS: Record<string, string> = {
  inquiry: "bg-gray-100 text-gray-600",
  documents_collected: "bg-blue-100 text-blue-700",
  submitted: "bg-purple-100 text-purple-700",
  offer_received: "bg-amber-100 text-amber-700",
  visa_applied: "bg-orange-100 text-orange-700",
  visa_approved: "bg-teal-100 text-teal-700",
  enrolled: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

export default function StudentDetail({ id }: Props) {
  const [, setLocation] = useLocation();

  const { data: student, isLoading } = useGetStudent(id);
  const { data: applicationsResp } = useListApplications({ studentId: id });
  const { data: documentsResp } = useListDocuments({ studentId: id });

  const applications: any[] = (applicationsResp as any)?.data || applicationsResp || [];
  const documents: any[] = Array.isArray(documentsResp) ? documentsResp : (documentsResp as any)?.data || [];

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/staff/students")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1">
            {isLoading ? (
              <Skeleton className="h-8 w-48" />
            ) : (
              <h1 className="text-2xl font-display font-bold text-foreground">
                {student?.firstName} {student?.lastName}
              </h1>
            )}
            <p className="text-sm text-muted-foreground mt-0.5">Student Profile</p>
          </div>
          {!isLoading && (
            <Badge
              className={`capitalize px-3 py-1 rounded-full text-sm font-medium border-0 ${STATUS_COLORS[student?.status ?? "active"]}`}
            >
              {student?.status}
            </Badge>
          )}
        </div>

        <Tabs defaultValue="profile">
          <TabsList className="rounded-xl bg-secondary/60">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="applications">
              Applications {applications.length > 0 && `(${applications.length})`}
            </TabsTrigger>
            <TabsTrigger value="documents">
              Documents {documents.length > 0 && `(${documents.length})`}
            </TabsTrigger>
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile" className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Personal */}
              <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-4">
                <h2 className="font-semibold text-foreground">Personal Information</h2>
                {isLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
                  </div>
                ) : (
                  <div className="space-y-3 text-sm">
                    <InfoRow icon={<Calendar className="w-4 h-4" />} label="Date of Birth" value={student?.dateOfBirth} />
                    <InfoRow icon={<Globe className="w-4 h-4" />} label="Nationality" value={student?.nationality} />
                    <InfoRow icon={<Mail className="w-4 h-4" />} label="Email" value={student?.email} />
                    <InfoRow icon={<Phone className="w-4 h-4" />} label="Phone" value={student?.phone} />
                    <InfoRow icon={<User className="w-4 h-4" />} label="Mother's Name" value={student?.motherName} />
                    <InfoRow icon={<User className="w-4 h-4" />} label="Father's Name" value={student?.fatherName} />
                    <InfoRow icon={<Home className="w-4 h-4" />} label="Address" value={student?.address} />
                  </div>
                )}
              </div>

              {/* Passport + Academic stacked in right column */}
              <div className="space-y-4">
                <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-4">
                  <h2 className="font-semibold text-foreground">Passport / ID</h2>
                  {isLoading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
                    </div>
                  ) : (
                    <div className="space-y-3 text-sm">
                      <InfoRow icon={<FileText className="w-4 h-4" />} label="Passport No" value={student?.passportNumber} />
                      <InfoRow icon={<Calendar className="w-4 h-4" />} label="Issue Date" value={student?.passportIssueDate} />
                      <InfoRow icon={<Calendar className="w-4 h-4" />} label="Expiry Date" value={student?.passportExpiry} />
                    </div>
                  )}
                </div>

                <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-4">
                  <h2 className="font-semibold text-foreground">Academic Information</h2>
                  {isLoading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
                    </div>
                  ) : (
                    <div className="space-y-3 text-sm">
                      <InfoRow icon={<GraduationCap className="w-4 h-4" />} label="High School" value={student?.highSchool} />
                      <InfoRow icon={<GraduationCap className="w-4 h-4" />} label="Graduation Year" value={student?.graduationYear?.toString()} />
                      <InfoRow icon={<GraduationCap className="w-4 h-4" />} label="GPA" value={student?.gpa} />
                      <InfoRow icon={<GraduationCap className="w-4 h-4" />} label="Language Score" value={student?.languageScore} />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {student?.notes && (
              <div className="mt-4 bg-card rounded-2xl border shadow-sm p-6">
                <h2 className="font-semibold text-foreground mb-2">Notes</h2>
                <p className="text-sm text-foreground">{student.notes}</p>
              </div>
            )}
          </TabsContent>

          {/* Applications Tab */}
          <TabsContent value="applications" className="mt-4">
            <div className="bg-card rounded-2xl border shadow-sm overflow-hidden">
              {applications.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  <GraduationCap className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No applications yet.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-foreground">University</th>
                      <th className="text-left px-4 py-3 font-semibold text-foreground">Program</th>
                      <th className="text-left px-4 py-3 font-semibold text-foreground">Stage</th>
                      <th className="text-left px-4 py-3 font-semibold text-foreground">Created</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map((app: any) => (
                      <tr key={app.id} className="border-t hover:bg-primary/5 transition-colors">
                        <td className="px-4 py-3 font-medium">{app.universityId ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{app.programId ?? "—"}</td>
                        <td className="px-4 py-3">
                          <Badge
                            className={`capitalize text-xs px-2 py-0.5 border-0 rounded-full ${STAGE_COLORS[app.stage] ?? "bg-gray-100 text-gray-600"}`}
                          >
                            {app.stage?.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {new Date(app.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setLocation(`/staff/applications/${app.id}`)}
                          >
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents" className="mt-4">
            <div className="bg-card rounded-2xl border shadow-sm overflow-hidden">
              {documents.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No documents attached.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-foreground">Name</th>
                      <th className="text-left px-4 py-3 font-semibold text-foreground">Type</th>
                      <th className="text-left px-4 py-3 font-semibold text-foreground">Status</th>
                      <th className="text-left px-4 py-3 font-semibold text-foreground">Uploaded</th>
                      <th className="text-left px-4 py-3 font-semibold text-foreground">File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc: any) => (
                      <tr key={doc.id} className="border-t hover:bg-primary/5 transition-colors">
                        <td className="px-4 py-3 font-medium">{doc.name}</td>
                        <td className="px-4 py-3 text-muted-foreground capitalize">{doc.type}</td>
                        <td className="px-4 py-3">
                          <Badge className="capitalize text-xs px-2 py-0.5 border-0 rounded-full bg-secondary text-secondary-foreground">
                            {doc.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {new Date(doc.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          {doc.fileData && (
                            <button
                              onClick={() => {
                                const mimeType = doc.mimeType || "application/octet-stream";
                                const isImage = mimeType.startsWith("image/");
                                const ext = mimeType === "application/pdf" ? "pdf" : isImage ? mimeType.split("/")[1] : "bin";
                                const link = document.createElement("a");
                                link.href = `data:${mimeType};base64,${doc.fileData}`;
                                link.download = `${doc.name}.${ext}`;
                                link.click();
                              }}
                              className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                              İndir
                            </button>
                          )}
                          {doc.fileUrl && !doc.fileData && (
                            <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                              Görüntüle
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium text-foreground">{value || "—"}</p>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useListStudents, useCreateStudent } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, Plus, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  inactive: "bg-gray-100 text-gray-600",
  graduated: "bg-blue-100 text-blue-700",
  suspended: "bg-red-100 text-red-700",
};

const EMPTY_FORM = {
  firstName: "", lastName: "", email: "", phone: "",
  nationality: "", dateOfBirth: "", passportNumber: "",
  highSchool: "", graduationYear: "", gpa: "", languageScore: "",
};

export default function StudentsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data, isLoading } = useListStudents({ search });
  const createStudent = useCreateStudent();

  function handleCreate() {
    if (!form.firstName || !form.lastName) return;
    createStudent.mutate(
      {
        data: {
          ...form,
          graduationYear: form.graduationYear ? parseInt(form.graduationYear, 10) : undefined,
          status: "active",
        },
      },
      {
        onSuccess: (student: any) => {
          toast({ title: "Student created" });
          setCreateOpen(false);
          setForm(EMPTY_FORM);
          queryClient.invalidateQueries({ queryKey: ["/api/students"] });
          setLocation(`/staff/students/${student.id}`);
        },
      }
    );
  }

  const students = data?.data ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Students</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage enrolled students and their applications.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search students..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-card"
              />
            </div>
            <Button className="rounded-full shadow-lg shadow-primary/20" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> Add Student
            </Button>
          </div>
        </div>

        <div className="bg-card rounded-2xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-secondary/50">
                <TableRow>
                  <TableHead className="font-semibold text-foreground">Name</TableHead>
                  <TableHead className="font-semibold text-foreground">Contact</TableHead>
                  <TableHead className="font-semibold text-foreground">Nationality</TableHead>
                  <TableHead className="font-semibold text-foreground">Status</TableHead>
                  <TableHead className="font-semibold text-foreground">Joined</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><div className="h-5 w-32 bg-secondary rounded animate-pulse" /></TableCell>
                      <TableCell><div className="h-5 w-40 bg-secondary rounded animate-pulse" /></TableCell>
                      <TableCell><div className="h-5 w-20 bg-secondary rounded animate-pulse" /></TableCell>
                      <TableCell><div className="h-6 w-16 bg-secondary rounded-full animate-pulse" /></TableCell>
                      <TableCell><div className="h-5 w-24 bg-secondary rounded animate-pulse" /></TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  ))
                ) : students.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      No students found.
                    </TableCell>
                  </TableRow>
                ) : (
                  students.map((student) => (
                    <TableRow
                      key={student.id}
                      className="hover:bg-primary/5 transition-colors cursor-pointer"
                      onClick={() => setLocation(`/staff/students/${student.id}`)}
                    >
                      <TableCell className="font-medium">
                        {student.firstName} {student.lastName}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{student.email}</div>
                        <div className="text-xs text-muted-foreground">{student.phone}</div>
                      </TableCell>
                      <TableCell>{student.nationality || "—"}</TableCell>
                      <TableCell>
                        <Badge
                          className={`capitalize text-xs px-2.5 py-0.5 border-0 rounded-full ${STATUS_COLORS[student.status] ?? "bg-gray-100 text-gray-600"}`}
                        >
                          {student.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(student.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLocation(`/staff/students/${student.id}`);
                          }}
                        >
                          <FileText className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="p-4 border-t flex items-center justify-between text-sm text-muted-foreground bg-secondary/20">
            <div>Showing {students.length} of {data?.meta?.total ?? 0} students</div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled>Previous</Button>
              <Button variant="outline" size="sm" disabled>Next</Button>
            </div>
          </div>
        </div>
      </div>

      {/* Create Student Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Student</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label>First Name *</Label>
              <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} placeholder="First name" />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name *</Label>
              <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} placeholder="Last name" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 000 0000" />
            </div>
            <div className="space-y-1.5">
              <Label>Nationality</Label>
              <Input value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} placeholder="e.g. Turkish" />
            </div>
            <div className="space-y-1.5">
              <Label>Date of Birth</Label>
              <Input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Passport Number</Label>
              <Input value={form.passportNumber} onChange={(e) => setForm({ ...form, passportNumber: e.target.value })} placeholder="e.g. AB1234567" />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>High School</Label>
              <Input value={form.highSchool} onChange={(e) => setForm({ ...form, highSchool: e.target.value })} placeholder="e.g. Ankara High School" />
            </div>
            <div className="space-y-1.5">
              <Label>Graduation Year</Label>
              <Input type="number" value={form.graduationYear} onChange={(e) => setForm({ ...form, graduationYear: e.target.value })} placeholder="e.g. 2022" />
            </div>
            <div className="space-y-1.5">
              <Label>GPA</Label>
              <Input value={form.gpa} onChange={(e) => setForm({ ...form, gpa: e.target.value })} placeholder="e.g. 3.8 / 4.0" />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Language Score</Label>
              <Input value={form.languageScore} onChange={(e) => setForm({ ...form, languageScore: e.target.value })} placeholder="e.g. IELTS 7.0" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createStudent.isPending || !form.firstName || !form.lastName}>
              {createStudent.isPending ? "Creating…" : "Create Student"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

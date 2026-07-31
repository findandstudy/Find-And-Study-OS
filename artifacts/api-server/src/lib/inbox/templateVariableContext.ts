import {
  applicationsTable,
  conversationsTable,
  db,
  externalContactsTable,
  leadsTable,
  studentsTable,
} from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  buildMessageTemplateVariableContext,
  type MessageTemplateVariableContext,
} from "./templateVariables";

/**
 * Builds the authoritative placeholder context for one external conversation.
 * The newest live application wins for programme/university/intake; lead
 * interests are the fallback before an application exists.
 */
export async function loadConversationTemplateVariableContext(
  conversationId: number,
): Promise<MessageTemplateVariableContext> {
  const [link] = await db
    .select({
      displayName: externalContactsTable.displayName,
      leadId: externalContactsTable.leadId,
      studentId: externalContactsTable.studentId,
    })
    .from(conversationsTable)
    .leftJoin(
      externalContactsTable,
      eq(conversationsTable.externalContactId, externalContactsTable.id),
    )
    .where(eq(conversationsTable.id, conversationId))
    .limit(1);

  if (!link) return {};

  const [lead] = link.leadId
    ? await db
        .select({
          firstName: leadsTable.firstName,
          lastName: leadsTable.lastName,
          interestedProgram: leadsTable.interestedProgram,
          interestedUniversity: leadsTable.interestedUniversity,
          interestedLevel: leadsTable.interestedLevel,
          convertedStudentId: leadsTable.convertedStudentId,
        })
        .from(leadsTable)
        .where(and(eq(leadsTable.id, link.leadId), isNull(leadsTable.deletedAt)))
        .limit(1)
    : [null];

  const effectiveStudentId = link.studentId ?? lead?.convertedStudentId ?? null;
  const [student] = effectiveStudentId
    ? await db
        .select({
          firstName: studentsTable.firstName,
          lastName: studentsTable.lastName,
          interestedLevel: studentsTable.interestedLevel,
        })
        .from(studentsTable)
        .where(
          and(
            eq(studentsTable.id, effectiveStudentId),
            isNull(studentsTable.deletedAt),
          ),
        )
        .limit(1)
    : [null];

  const [application] = effectiveStudentId
    ? await db
        .select({
          programName: applicationsTable.programName,
          universityName: applicationsTable.universityName,
          level: applicationsTable.level,
          intake: applicationsTable.intake,
        })
        .from(applicationsTable)
        .where(
          and(
            eq(applicationsTable.studentId, effectiveStudentId),
            isNull(applicationsTable.deletedAt),
          ),
        )
        .orderBy(desc(applicationsTable.createdAt), desc(applicationsTable.id))
        .limit(1)
    : [null];

  return buildMessageTemplateVariableContext({
    displayName: link.displayName,
    lead,
    student,
    application,
  });
}

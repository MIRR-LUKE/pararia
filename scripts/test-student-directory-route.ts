#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { prisma } from "@/lib/db";
import { assertMutatingFixtureEnvironment } from "./lib/environment-safety";
import { createCriticalPathSmokeApi, loadCriticalPathSmokeEnv } from "./lib/critical-path-smoke";

type StudentDirectoryRouteSmokeResult = {
  studentId: string;
  updatedGrade: string | null;
  updatedGuardianNames: string | null;
  listContainsCreatedStudentBeforeArchive: boolean;
  listContainsCreatedStudentAfterArchive: boolean;
  roomReflectsEdit: boolean;
};

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

export async function runStudentDirectoryRouteSmoke(
  baseUrl: string
): Promise<StudentDirectoryRouteSmokeResult> {
  await loadCriticalPathSmokeEnv();
  assertMutatingFixtureEnvironment(baseUrl, "student-directory-route");

  const uniqueSuffix = Date.now();
  const studentName = `Route Student ${uniqueSuffix}`;
  const { api, close } = await createCriticalPathSmokeApi(baseUrl);
  let studentId: string | null = null;

  try {
    const createResponse = await api.post("/api/students", {
      data: {
        name: studentName,
        nameKana: "ルート スチューデント",
        grade: "高2",
        course: "route-smoke",
        guardianNames: "保護者A",
      },
    });
    assert.equal(createResponse.ok(), true, `student create failed: ${createResponse.status()}`);
    const createBody = await createResponse.json();
    studentId = String(createBody?.student?.id ?? "");
    assert.ok(studentId, "created student id");

    const listBeforeArchiveResponse = await api.get("/api/students?limit=200");
    assert.equal(listBeforeArchiveResponse.ok(), true, `students list failed: ${listBeforeArchiveResponse.status()}`);
    const listBeforeArchiveBody = await listBeforeArchiveResponse.json();
    const createdListRow = (listBeforeArchiveBody.students ?? []).find((student: any) => student.id === studentId);
    assert.ok(createdListRow, "created student appears in directory");
    assert.equal(typeof createdListRow.createdAt, "string", "directory createdAt");

    const updateResponse = await api.put(`/api/students/${studentId}`, {
      data: {
        grade: "高3",
        course: "route-smoke-updated",
        guardianNames: "保護者B",
      },
    });
    assert.equal(updateResponse.ok(), true, `student update failed: ${updateResponse.status()}`);
    const updateBody = await updateResponse.json();
    assert.equal(updateBody.student?.grade ?? null, "高3");
    assert.equal(updateBody.student?.guardianNames ?? null, "保護者B");

    const readResponse = await api.get(`/api/students/${studentId}`);
    assert.equal(readResponse.ok(), true, `student read failed: ${readResponse.status()}`);
    const readBody = await readResponse.json();
    assert.equal(readBody.student?.grade ?? null, "高3");
    assert.equal(readBody.student?.guardianNames ?? null, "保護者B");

    const roomResponse = await api.get(`/api/students/${studentId}/room`);
    assert.equal(roomResponse.ok(), true, `student room failed: ${roomResponse.status()}`);
    const roomBody = await roomResponse.json();
    assert.equal(roomBody.student?.grade ?? null, "高3");
    assert.equal(roomBody.student?.course ?? null, "route-smoke-updated");
    assert.equal(roomBody.student?.guardianNames ?? null, "保護者B");

    const archiveResponse = await api.delete(`/api/students/${studentId}`);
    assert.equal(archiveResponse.ok(), true, `student archive failed: ${archiveResponse.status()}`);

    const readAfterArchiveResponse = await api.get(`/api/students/${studentId}`);
    assert.equal(readAfterArchiveResponse.status(), 404, "archived student should be hidden");

    const listAfterArchiveResponse = await api.get("/api/students?limit=200");
    assert.equal(
      listAfterArchiveResponse.ok(),
      true,
      `students list after archive failed: ${listAfterArchiveResponse.status()}`
    );
    const listAfterArchiveBody = await listAfterArchiveResponse.json();
    const archivedListRow = (listAfterArchiveBody.students ?? []).find((student: any) => student.id === studentId);
    assert.equal(Boolean(archivedListRow), false, "archived student removed from directory");

    return {
      studentId,
      updatedGrade: updateBody.student?.grade ?? null,
      updatedGuardianNames: updateBody.student?.guardianNames ?? null,
      listContainsCreatedStudentBeforeArchive: Boolean(createdListRow),
      listContainsCreatedStudentAfterArchive: Boolean(archivedListRow),
      roomReflectsEdit:
        roomBody.student?.grade === "高3" &&
        roomBody.student?.course === "route-smoke-updated" &&
        roomBody.student?.guardianNames === "保護者B",
    };
  } finally {
    if (studentId) {
      await prisma.student.updateMany({
        where: {
          id: studentId,
          archivedAt: null,
        },
        data: {
          archivedAt: new Date(),
          archiveReason: "student_directory_route_smoke_cleanup",
        },
      });
    }
    await close().catch(() => {});
  }
}

async function main() {
  const baseUrl = argValue("--base-url") || process.env.CRITICAL_PATH_BASE_URL || "http://127.0.0.1:3000";
  const result = await runStudentDirectoryRouteSmoke(baseUrl);
  console.log(JSON.stringify({ label: "student-directory-route", baseUrl, result }, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

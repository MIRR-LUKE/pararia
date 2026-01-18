import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // 1. 組織を作成（既に存在する場合はスキップ）
  const orgId = "org-demo";
  let org = await prisma.organization.findUnique({
    where: { id: orgId },
  });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        id: orgId,
        name: "デモ塾",
      },
    });
    console.log("✅ Created organization:", org.name);
  } else {
    console.log("ℹ️  Organization already exists:", org.name);
  }

  // 2. ユーザーを作成（既に存在する場合はスキップ）
  const adminEmail = "admin@demo.com";
  let admin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!admin) {
    const passwordHash = await bcrypt.hash("demo123", 10);
    admin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        name: "管理者",
        role: "ADMIN",
        organizationId: orgId,
      },
    });
    console.log("✅ Created admin user:", admin.email);
  } else {
    console.log("ℹ️  Admin user already exists:", admin.email);
  }

  // 3. デモ生徒を作成（モックデータと同じIDを使用）
  const studentId = "s-1";
  const studentName = "宮本 徹生";
  let student = await prisma.student.findUnique({
    where: { id: studentId },
  });

  if (!student) {
    student = await prisma.student.create({
      data: {
        id: studentId, // モックデータと同じIDを明示的に指定
        organizationId: orgId,
        name: studentName,
        grade: "高校1年",
        course: "進学コース",
        enrollmentDate: new Date("2024-04-01"),
        birthdate: new Date("2009-06-18"),
        guardianNames: "父: 宮本 健司 / 母: 宮本 明日香",
      },
    });
    console.log("✅ Created demo student:", student.name, `(ID: ${student.id})`);
  } else {
    // 既存の生徒を更新（組織IDが一致することを確認）
    if (student.organizationId !== orgId) {
      student = await prisma.student.update({
        where: { id: studentId },
        data: { organizationId: orgId },
      });
      console.log("✅ Updated demo student organization:", student.name);
    } else {
      console.log("ℹ️  Demo student already exists:", student.name, `(ID: ${student.id})`);
    }
  }

  console.log("🎉 Seeding completed!");
  console.log("\n📋 Summary:");
  console.log(`   Organization ID: ${orgId}`);
  console.log(`   Admin Email: ${adminEmail}`);
  console.log(`   Admin Password: demo123`);
  console.log(`   Student ID: ${student.id} (matches mock data: s-1)`);
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


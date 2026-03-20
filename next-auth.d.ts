import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role?: string;
    organizationId?: string;
  }

  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: string;
      organizationId: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    organizationId?: string;
  }
}

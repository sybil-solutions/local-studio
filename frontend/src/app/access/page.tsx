import { AccessPage } from "@/features/access/access-page";

interface AccessRouteProps {
  readonly searchParams: Promise<{ readonly error?: string | string[] }>;
}

export default async function AccessRoute({ searchParams }: AccessRouteProps) {
  const error = (await searchParams).error;
  return <AccessPage invalid={error === "invalid"} />;
}

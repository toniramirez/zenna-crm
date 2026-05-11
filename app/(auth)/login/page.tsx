import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

type LoginPageProps = {
  searchParams: Promise<{ redirect?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Already logged in → bounce to dashboard
  if (user) redirect("/turnos");

  const { redirect: redirectTo } = await searchParams;
  const safeRedirect =
    redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//")
      ? redirectTo
      : "/turnos";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Bienvenida de vuelta</CardTitle>
        <CardDescription>
          Ingresá con tu email y contraseña para gestionar la peluquería.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm redirectTo={safeRedirect} />
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-1 text-sm text-muted-foreground">
        <span>
          ¿Primera vez?{" "}
          <Link href="/register" className="underline hover:text-foreground">
            Registrar la primera dueña
          </Link>
          .
        </span>
        <span className="text-xs">
          Solo se puede registrar una vez. Después la dueña crea al resto.
        </span>
      </CardFooter>
    </Card>
  );
}

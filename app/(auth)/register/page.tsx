import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { RegisterForm } from "./register-form";

export default async function RegisterPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/turnos");

  // Has anyone already registered as owner? If so, this page is locked.
  const { count } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "owner")
    .eq("active", true);

  const ownerExists = (count ?? 0) > 0;

  if (ownerExists) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Registro cerrado</CardTitle>
          <CardDescription>
            El sistema ya tiene una dueña registrada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTitle>¿Querés acceder?</AlertTitle>
            <AlertDescription>
              Pedile a la dueña de la peluquería que te cree una cuenta desde el
              panel de administración.
            </AlertDescription>
          </Alert>
          <Button asChild className="w-full">
            <Link href="/login">Ir al login</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Registrar la primera dueña</CardTitle>
        <CardDescription>
          Esta página solo se puede usar una vez. Una vez creada la dueña, todas
          las altas posteriores se hacen desde el panel.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RegisterForm />
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        <Link href="/login" className="underline hover:text-foreground">
          Volver al login
        </Link>
      </CardFooter>
    </Card>
  );
}

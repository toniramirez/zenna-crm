"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { changePasswordSchema } from "@/lib/validations/auth";

export type ChangePasswordActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: boolean;
};

export async function changePasswordAction(
  formData: FormData,
): Promise<ChangePasswordActionState> {
  const parsed = changePasswordSchema.safeParse({
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString();
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.newPassword,
  });

  if (error) {
    return {
      error:
        error.message === "New password should be different from the old password."
          ? "La nueva contraseña tiene que ser distinta a la anterior."
          : "No pudimos cambiar la contraseña. Intentalo de nuevo.",
    };
  }

  revalidatePath("/cambiar-contrasena");
  return { success: true };
}

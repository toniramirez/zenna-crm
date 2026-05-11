"use client";

import { Loader2, Lock } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitFinanzasPin } from "./pin-actions";

export function PinGate() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await submitFinanzasPin(formData);
      if (result?.error) {
        setError(result.error);
        if (inputRef.current) {
          inputRef.current.value = "";
          inputRef.current.focus();
        }
      }
    });
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
            <Lock className="size-5 text-muted-foreground" />
          </div>
          <CardTitle>Finanzas bloqueadas</CardTitle>
          <CardDescription>
            Ingresá el PIN para acceder a esta sección.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="finanzas-pin">PIN</Label>
              <Input
                ref={inputRef}
                id="finanzas-pin"
                name="pin"
                type="password"
                inputMode="numeric"
                pattern="\d*"
                maxLength={8}
                autoComplete="off"
                autoFocus
                required
                disabled={isPending}
                aria-invalid={error ? true : undefined}
              />
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
            </div>
            <Button type="submit" disabled={isPending} className="w-full">
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Verificando…
                </>
              ) : (
                "Desbloquear"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

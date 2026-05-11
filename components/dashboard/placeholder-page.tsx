import type { LucideIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function PlaceholderPage({
  title,
  description,
  icon: Icon,
  body,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  body: string;
}) {
  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon className="size-5 text-primary" />
            En construcción
          </CardTitle>
          <CardDescription>
            Esta sección todavía no está implementada.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {body}
        </CardContent>
      </Card>
    </div>
  );
}

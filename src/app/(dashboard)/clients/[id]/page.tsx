import { ClientAssignment } from "@/features/settings/components/client-assignment";
import { getStudioRole } from "@/lib/roles";
import { getActiveMasters } from "@/features/masters/server/queries";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { getClientById, getClientMedicalProfile, getClientActivity } from "@/features/clients/server/queries";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect, notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Edit, Phone, Mail, Calendar as CalendarIcon, User, History, ShieldAlert, AtSign, Image as ImageIcon, FileText } from "lucide-react";
import Link from "next/link";
import { formatPhone } from "@/lib/phone";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { MedicalProfileForm } from "@/features/clients/components/medical-profile-form";
import { ClientMediaSection } from "@/features/media/components/client-media-section";
import { Timeline, TimelineItem } from "@/components/shared/timeline";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/db";

interface ClientDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ClientDetailPage({ params }: ClientDetailPageProps) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) redirect("/dashboard");
  if (!await hasPermission(db, session.user.id, studioId, "CLIENT_READ")) redirect("/dashboard");

  const role = await getStudioRole(db, session.user.id, studioId);
  const canAssign = (role === "OWNER" || role === "ADMIN") && await hasPermission(db, session.user.id, studioId, "CLIENT_UPDATE");
  const assignmentOptions = canAssign ? await getActiveMasters(studioId) : [];
  const client = await getClientById(id, studioId);
  if (!client) notFound();
  const [canReadMedical, canEditMedical, canReadMedia, canReadConsent] = await Promise.all(
    (["MEDICAL_PROFILE_READ", "MEDICAL_PROFILE_UPDATE", "MEDIA_READ", "CONSENT_READ"] as const)
      .map((permission) => hasPermission(db, session.user.id, studioId, permission))
  );
  const [medicalProfile, events] = await Promise.all([
    canReadMedical ? getClientMedicalProfile(id, studioId) : undefined,
    getClientActivity(id, studioId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={client.fullName}
        description={`Статус: ${client.clientStatus}`}
        backHref="/clients"
      >
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link href={`/clients/${id}/edit`}>
            <Edit className="h-4 w-4" />
            <span>Редактировать</span>
          </Link>
        </Button>
      </PageHeader>

      {canAssign && <ClientAssignment clientId={client.id} currentId={client.assignedMasterId} masters={assignmentOptions} />}
      <Tabs defaultValue="info" className="w-full">
        <TabsList className="grid w-full grid-cols-5 lg:w-[600px]">
          <TabsTrigger value="info" className="gap-2">
            <User className="h-4 w-4" />
            <span className="hidden sm:inline">Инфо</span>
          </TabsTrigger>
          {canReadMedical && (<TabsTrigger value="medical" className="gap-2">
            <ShieldAlert className="h-4 w-4" />
            <span className="hidden sm:inline">Мед. профиль</span>
          </TabsTrigger>)}
          {canReadMedia && (<TabsTrigger value="media" className="gap-2">
            <ImageIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Фото</span>
          </TabsTrigger>)}
          {canReadConsent && (<TabsTrigger value="consent" className="gap-2">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Согласия</span>
          </TabsTrigger>)}
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" />
            <span className="hidden sm:inline">История</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Контактные данные</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sand text-taupe">
                  <Phone className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Телефон</p>
                  <p className="text-sm font-medium">{formatPhone(client.phone)}</p>
                </div>
              </div>
              
              {client.instagram && (
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sand text-taupe">
                    <AtSign className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Instagram</p>
                    <p className="text-sm font-medium">{client.instagram}</p>
                  </div>
                </div>
              )}

              {client.email && (
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sand text-taupe">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Email</p>
                    <p className="text-sm font-medium">{client.email}</p>
                  </div>
                </div>
              )}

              {client.birthDate && (
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sand text-taupe">
                    <CalendarIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Дата рождения</p>
                    <p className="text-sm font-medium">
                      {format(new Date(client.birthDate), "d MMMM yyyy", { locale: ru })}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {client.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Заметки</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{client.notes}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {canReadMedical && (<TabsContent value="medical" className="mt-6">
          <MedicalProfileForm
            clientId={client.id}
            initialData={medicalProfile}
            readonly={!canEditMedical}
          />
        </TabsContent>)}

        {canReadMedia && (<TabsContent value="media" className="mt-6">
          <ClientMediaSection clientId={client.id} />
        </TabsContent>)}

        {canReadConsent && (<TabsContent value="consent" className="mt-6">
          <ClientMediaSection clientId={client.id} initialType="consent" />
        </TabsContent>)}

        <TabsContent value="history" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>История активности</CardTitle>
            </CardHeader>
            <CardContent>
              {events && events.length > 0 ? (
                <Timeline>
                  {events.map((event, index) => (
                    <TimelineItem
                      key={event.id}
                      title={event.title}
                      description={event.description || ""}
                      date={new Date(event.createdAt)}
                      isLast={index === events.length - 1}
                    />
                  ))}
                </Timeline>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <History className="h-12 w-12 text-muted/30 mb-4" />
                  <p className="text-muted-foreground">История активности пуста</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

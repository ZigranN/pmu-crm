import { MedicalMergeReview } from "@/features/clients/components/medical-merge-review";
import { LANGUAGES, INTEREST_ZONES, CLIENT_KINDS, CLIENT_SOURCES } from "@/features/clients/administrative";
import { ClientAssignment } from "@/features/settings/components/client-assignment";
import { getActiveMasters } from "@/features/masters/server/queries";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { getClientById, getClientMedicalHistory, getClientMedicalProfile, getClientActivity, getClientMasterLabels } from "@/features/clients/server/queries";
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
  let context;
  try {
    context = await requireBrowserStudioPermission("CLIENT_READ");
  } catch {
    redirect("/dashboard");
  }
  const studioId = context.studioId;

  const canReadOffers = await hasPermission(db, context.userId, studioId, "OFFER_READ");
  const role = context.role;
  const canAssign = (role === "OWNER" || role === "ADMIN") && await hasPermission(db, context.userId, studioId, "CLIENT_UPDATE");
  const assignmentOptions = canAssign ? await getActiveMasters(studioId) : [];
  const client = await getClientById(id, studioId);
  if (!client) notFound();
  if (client.id !== id) redirect(`/clients/${client.id}`);
  const masterLabels = await getClientMasterLabels(id, studioId);
  const [canReadMedical, canEditMedical, canReadMedia, canReadConsent] = await Promise.all(
    (["MEDICAL_PROFILE_READ", "MEDICAL_PROFILE_UPDATE", "MEDIA_READ", "CONSENT_READ"] as const)
      .map((permission) => hasPermission(db, context.userId, studioId, permission))
  );
  const [medicalProfile, events, medicalHistory] = await Promise.all([
    canReadMedical ? getClientMedicalProfile(id, studioId) : undefined,
    getClientActivity(id, studioId),
    canReadMedical ? getClientMedicalHistory(id, studioId) : [],
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
      {canReadOffers && <Button asChild variant="outline" size="sm"><Link href={`/clients/${id}/offers`}>Custom Offer</Link></Button>}

      {canAssign && <div className="grid gap-4 lg:grid-cols-2"><ClientAssignment key={`assigned:${client.assignedMasterId}`} clientId={client.id} currentId={client.assignedMasterId} masters={assignmentOptions} />
        <ClientAssignment key={`preferred:${client.preferredMasterId}`} kind="preferred" clientId={client.id} currentId={client.preferredMasterId} masters={assignmentOptions} /></div>}
      {canAssign && <Link className="inline-block underline" href={`/clients/${id}/merge`}>Объединить с другой карточкой</Link>}
      <Tabs defaultValue="info" className="w-full">
        <TabsList className="grid w-full grid-cols-5 lg:w-[600px]">
          <TabsTrigger value="info" className="gap-2">
            <User className="h-4 w-4" />
            <span className="hidden sm:inline">Админ. карта</span>
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
          <TabsTrigger aria-label="История" value="history" className="gap-2">
            <History className="h-4 w-4" />
            <span className="hidden sm:inline">История</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="mt-6 space-y-6">
          <Card><CardHeader><CardTitle>Административная карточка</CardTitle></CardHeader><CardContent className="space-y-2">
            <p>WhatsApp: {client.whatsapp ? formatPhone(client.whatsapp) : "Не указан"}</p>
            <p>Язык: {client.language ? LANGUAGES[client.language as keyof typeof LANGUAGES] : "Не уточнён"}</p>
            <p>Источник: {client.source ? CLIENT_SOURCES[client.source as keyof typeof CLIENT_SOURCES] ?? client.source : "Не уточнён"}</p>
            <p>Тип клиента: {client.clientKind ? CLIENT_KINDS[client.clientKind as keyof typeof CLIENT_KINDS] : "Не уточнён"}</p>
            <p>Интересующие зоны: {client.interestedZones === null ? "Не уточнены" : client.interestedZones.length ? client.interestedZones.map(zone => INTEREST_ZONES[zone as keyof typeof INTEREST_ZONES]).join(", ") : "Не выбраны"}</p>
            {client.treatmentZone && <p>Зона из старой карточки: {client.treatmentZone}</p>}
            <p>Предыдущий PMU со слов клиента: {client.reportedPreviousPmu === null ? "Не уточнено" : client.reportedPreviousPmu ? "Да" : "Нет"}</p>
            <p>Назначенный мастер: {masterLabels?.assignedName ?? "Не назначен"}</p><p>Предпочтительный мастер: {masterLabels?.preferredName ?? "Не выбран"}</p>
            <p className="text-sm text-muted-foreground">Сведения со слов клиента не являются медицинским заключением. Медицинскую карту и допуск заполняет уполномоченный специалист.</p>
          </CardContent></Card>
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
          {medicalProfile?.mergeReviewRequired && <p role="alert" className="rounded border p-3">После объединения обнаружены несколько медицинских профилей. Специалист должен проверить текущие и исторические сведения; объединение не является медицинским допуском.</p>}
          {medicalHistory.map(profile => <details key={profile.id} className="rounded border p-3"><summary>Исторический медицинский профиль · {profile.id}</summary><MedicalProfileForm clientId={id} initialData={profile} readonly /></details>)}
          {canEditMedical && medicalProfile?.mergeReviewRequired && <MedicalMergeReview clientId={id} updatedAt={medicalProfile.updatedAt.toISOString()} />}
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

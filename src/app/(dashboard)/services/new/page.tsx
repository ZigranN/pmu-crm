import { PageHeader } from "@/components/shared/page-header";
import { ServiceForm } from "@/features/services/components/service-form";

export default function NewServicePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Новая услуга"
        description="Добавьте новую услугу в прейскурант студии"
        backHref="/services"
      />
      <ServiceForm />
    </div>
  );
}

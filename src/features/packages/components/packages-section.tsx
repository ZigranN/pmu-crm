"use client";

import React from "react";
import { Sparkles } from "lucide-react";
import type { PackageReadinessAggregate } from "../domain/types";
import { TotalFacePackageCard } from "./total-face-package-card";
import { CreateTotalFaceDialog } from "./create-total-face-dialog";

interface PackagesSectionProps {
  clientId: string;
  packages: PackageReadinessAggregate[];
  canManage: boolean;
}

export function PackagesSection({
  clientId,
  packages,
  canManage,
}: PackagesSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Комплексные пакеты (Total Face)</h3>
          <p className="text-sm text-muted-foreground">
            Управление многозонными программами с независимым контролем каждого цикла
          </p>
        </div>
        {canManage && <CreateTotalFaceDialog clientId={clientId} />}
      </div>

      {packages.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
          <h4 className="text-sm font-semibold">Нет активных пакетов Total Face</h4>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1 mb-4">
            Total Face объединяет несколько зон (брови, глаза, губы) в единую программу с отдельным контролем каждого цикла.
          </p>
          {canManage && <CreateTotalFaceDialog clientId={clientId} />}
        </div>
      ) : (
        <div className="space-y-4">
          {packages.map((pkg) => (
            <TotalFacePackageCard
              key={pkg.packageId}
              pkg={pkg}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

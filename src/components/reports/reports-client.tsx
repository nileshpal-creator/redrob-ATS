"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PipelineFunnelTab } from "@/components/reports/pipeline-funnel-tab";
import { TimeToFillOfferTab } from "@/components/reports/time-to-fill-offer-tab";
import { RecruiterProductivityTab } from "@/components/reports/recruiter-productivity-tab";
import { OfferTatComplianceTab } from "@/components/reports/offer-tat-compliance-tab";
import { SavedReportsTab } from "@/components/reports/saved-reports-tab";

type Option = { id: string; label: string };

export function ReportsClient({
  canViewJobReports,
  canViewOfferReports,
  jobs,
  departments,
  locations,
  recruiters,
  sources,
  defaultTatThresholdDays,
}: {
  canViewJobReports: boolean;
  canViewOfferReports: boolean;
  jobs: Option[];
  departments: Option[];
  locations: Option[];
  recruiters: Option[];
  sources: Option[];
  defaultTatThresholdDays: number;
}) {
  const defaultTab = canViewJobReports ? "pipeline-funnel" : "offer-tat-compliance";

  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList>
        {canViewJobReports ? <TabsTrigger value="pipeline-funnel">Pipeline Funnel</TabsTrigger> : null}
        {canViewJobReports ? <TabsTrigger value="time-to-fill-offer">Time to Fill &amp; Offer</TabsTrigger> : null}
        {canViewJobReports ? <TabsTrigger value="recruiter-productivity">Recruiter Productivity</TabsTrigger> : null}
        {canViewOfferReports ? <TabsTrigger value="offer-tat-compliance">Offer TAT Compliance</TabsTrigger> : null}
        <TabsTrigger value="saved-reports">Saved Reports</TabsTrigger>
      </TabsList>

      {canViewJobReports ? (
        <TabsContent value="pipeline-funnel">
          <PipelineFunnelTab jobs={jobs} recruiters={recruiters} sources={sources} />
        </TabsContent>
      ) : null}
      {canViewJobReports ? (
        <TabsContent value="time-to-fill-offer">
          <TimeToFillOfferTab departments={departments} locations={locations} recruiters={recruiters} />
        </TabsContent>
      ) : null}
      {canViewJobReports ? (
        <TabsContent value="recruiter-productivity">
          <RecruiterProductivityTab recruiters={recruiters} />
        </TabsContent>
      ) : null}
      {canViewOfferReports ? (
        <TabsContent value="offer-tat-compliance">
          <OfferTatComplianceTab recruiters={recruiters} defaultThresholdDays={defaultTatThresholdDays} />
        </TabsContent>
      ) : null}
      <TabsContent value="saved-reports">
        <SavedReportsTab />
      </TabsContent>
    </Tabs>
  );
}

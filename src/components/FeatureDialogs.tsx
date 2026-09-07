import type { CampaignEvent, PollutionReport, VolunteerRegistration } from "@/app/types";
import Dialog from "./Dialog";
import { DonationPanel, RegistrationForm, ReportForm } from "./FeatureForms";

export function RegistrationDialog({ event, registrations, warning, onSave, onCancelRegistration, onClose }: { event: CampaignEvent | null; registrations: VolunteerRegistration[]; warning: string; onSave: (value: VolunteerRegistration) => void; onCancelRegistration: (id: string) => void; onClose: () => void }) {
  return <Dialog open={Boolean(event)} title="Đăng ký tình nguyện" onClose={onClose} size="lg">{event && <RegistrationForm event={event} registrations={registrations} warning={warning} onSave={onSave} onCancelRegistration={onCancelRegistration} />}</Dialog>;
}

export function ReportDialog({ open, reports, warning, onSave, onClose }: { open: boolean; reports: PollutionReport[]; warning: string; onSave: (value: PollutionReport) => void; onClose: () => void }) {
  return <Dialog open={open} title="Báo điểm ô nhiễm" onClose={onClose} size="lg"><ReportForm reports={reports} warning={warning} onSave={onSave} /></Dialog>;
}

export function DonationDialog({ open, initialAmount, onClose, onNotice }: { open: boolean; initialAmount: number; onClose: () => void; onNotice: (message: string) => void }) {
  return <Dialog open={open} title="Ủng hộ Quỹ Môi trường" onClose={onClose}><DonationPanel initialAmount={initialAmount} onNotice={onNotice} /></Dialog>;
}

import PmLayout from '@/Layouts/PmLayout';
import MeetingMinutesPanel from '@/Components/Pm/MeetingMinutesPanel';

export default function PmMinutes() {
  return (
    <PmLayout page="minutes">
      <MeetingMinutesPanel />
    </PmLayout>
  );
}

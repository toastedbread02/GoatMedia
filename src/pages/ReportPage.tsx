import { useNavigate, useParams } from 'react-router-dom';
import { ReportDialog, type ReportTarget } from '../components/ReportDialog';

export function ReportPage() {
  const { type = 'post', id = '' } = useParams();
  const navigate = useNavigate();
  const targetType = type === 'comment' || type === 'user' ? type : 'post';

  const target: ReportTarget = { type: targetType, id };
  return <ReportDialog target={target} onClose={() => navigate(-1)} />;
}

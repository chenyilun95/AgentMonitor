import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileBrowserView } from '../components/FileBrowserView';
import { useTranslation } from '../i18n';

export function DirectoryBrowser() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const path = searchParams.get('path') || '';
  const dirShort = path.replace(/^\/home\/[^/]+\//, '~/');

  return (
    <div className="directory-browser-page">
      <div className="directory-browser-header">
        <button className="btn btn-sm btn-outline" onClick={() => navigate(-1)}>
          &larr; {t('directoryBrowser.back')}
        </button>
        <span className="directory-browser-path" title={path}>{dirShort}</span>
      </div>
      <FileBrowserView rootPath={path} visible={true} />
    </div>
  );
}

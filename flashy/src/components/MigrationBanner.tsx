import { X, Info } from 'lucide-react';
import './MigrationBanner.css';

interface MigrationBannerProps {
  onClose: () => void;
}

export function MigrationBanner({ onClose }: MigrationBannerProps) {
  return (
    <div className="migration-banner">
      <div className="migration-banner-content">
        <Info size={20} className="migration-banner-icon" />
        <div className="migration-banner-text">
          <strong>Content migrated to WYSIWYG</strong>
          <span>Your markdown has been converted. Switch back to Markdown mode anytime to see the original format.</span>
        </div>
      </div>
      <button className="migration-banner-close" onClick={onClose} aria-label="Close">
        <X size={18} />
      </button>
    </div>
  );
}

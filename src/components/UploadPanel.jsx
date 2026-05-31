import { useRef, useState } from 'react';
import { scanUploads } from '../services/uploadScanner.js';
import { formatNumber } from '../utils/formatters.js';

export default function UploadPanel({ scanResult, onScanComplete, compact = false }) {
  const folderInputRef = useRef(null);
  const zipInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [progressText, setProgressText] = useState('Waiting for log package');

  async function handleFiles(files) {
    if (!files?.length) return;
    setIsScanning(true);
    setProgressText(`Scanning ${files.length} uploaded item${files.length === 1 ? '' : 's'}...`);
    try {
      const result = await scanUploads(files);
      onScanComplete(result);
      setProgressText('Inventory scan complete');
    } catch (error) {
      onScanComplete({ machines: [], totals: { files: 0, machines: 0, opcArchives: 0, logFiles: 0, systems: 0 }, errors: [error.message] });
      setProgressText('Scan failed');
    } finally {
      setIsScanning(false);
    }
  }

  return (
    <section className="card upload-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Upload logs</p>
          <h2>Inventory scanner</h2>
        </div>
        <span className={isScanning ? 'scan-state active' : 'scan-state'}>{progressText}</span>
      </div>

      <div
        className={isDragging ? 'drop-zone dragging' : 'drop-zone'}
        onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
      >
        <strong>Drop machine folders, opc.zip, or log archives</strong>
        <span>Recursive zip inspection is enabled. Deep parser extraction will be added on this foundation.</span>
        <div className="button-row">
          <button type="button" onClick={() => folderInputRef.current?.click()}>Upload folder</button>
          <button type="button" onClick={() => zipInputRef.current?.click()}>Upload zip files</button>
        </div>
        <input ref={folderInputRef} type="file" webkitdirectory="" directory="" multiple onChange={(event) => handleFiles(event.target.files)} />
        <input ref={zipInputRef} type="file" accept=".zip,.log,.txt,.csv,.json,.xml,.dat,.trace,.evtx" multiple onChange={(event) => handleFiles(event.target.files)} />
      </div>

      {!compact && (
        <div className="result-grid">
          <KpiMini label="Files inspected" value={scanResult.totals.files} />
          <KpiMini label="Machines" value={scanResult.totals.machines} />
          <KpiMini label="OPC archives" value={scanResult.totals.opcArchives} />
          <KpiMini label="Log files" value={scanResult.totals.logFiles} />
        </div>
      )}

      {scanResult.errors.length > 0 && (
        <div className="error-box">
          <strong>Scan errors</strong>
          {scanResult.errors.map((error) => <span key={error}>{error}</span>)}
        </div>
      )}
    </section>
  );
}

function KpiMini({ label, value }) {
  return (
    <div className="kpi-mini">
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

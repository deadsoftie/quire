import "./TelemetryConsentPrompt.css";

interface TelemetryConsentPromptProps {
  message: string;
  onGrant: () => void;
  onDecline: () => void;
}

export function TelemetryConsentPrompt({ message, onGrant, onDecline }: TelemetryConsentPromptProps) {
  return (
    <div className="telemetry-consent-prompt" role="status">
      <p className="telemetry-consent-prompt__message">{message}</p>
      <div className="telemetry-consent-prompt__actions">
        <button type="button" className="telemetry-consent-prompt__decline" onClick={onDecline}>
          No thanks
        </button>
        <button type="button" className="telemetry-consent-prompt__grant" onClick={onGrant}>
          Allow
        </button>
      </div>
    </div>
  );
}

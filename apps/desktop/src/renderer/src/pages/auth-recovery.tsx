import { useAuthStore } from "@lumen/core/auth";
import { Button } from "@lumen/ui/components/ui/button";
import { LumenIcon } from "@lumen/ui/components/common/lumen-icon";
import { useT } from "@lumen/views/i18n";
import { DragStrip } from "@lumen/views/platform";

export function DesktopAuthRecoveryPage({
  onRetry,
  isRetrying = false,
}: {
  onRetry?: () => void;
  isRetrying?: boolean;
}) {
  const { t } = useT("auth");
  const retryAuthentication = useAuthStore(
    (state) => state.retryAuthentication,
  );

  return (
    <div className="flex h-screen flex-col">
      <DragStrip />
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex max-w-sm flex-col items-center text-center">
          <LumenIcon bordered size="lg" />
          <h1 className="mt-6 text-title font-semibold">
            {t(($) => $.desktop.recovery.title)}
          </h1>
          <p className="mt-2 text-body text-muted-foreground">
            {t(($) => $.desktop.recovery.description)}
          </p>
          <Button
            className="mt-6"
            disabled={isRetrying}
            onClick={onRetry ?? retryAuthentication}
          >
            {isRetrying
              ? t(($) => $.desktop.recovery.retrying)
              : t(($) => $.desktop.recovery.retry)}
          </Button>
        </div>
      </div>
    </div>
  );
}

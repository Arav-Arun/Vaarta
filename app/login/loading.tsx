import { LoadingBlock } from "@/components/LoadingBlock";

/** Full-page transition state while the Google sign-in route prepares. */
export default function LoginLoading() {
  return (
    <div className="flex min-h-dvh flex-col-reverse lg:flex-row">
      <div className="flex flex-1 items-center justify-center px-6 py-10 lg:basis-[42%] lg:px-10 lg:py-14 xl:px-14">
        <div className="w-full max-w-md">
          <p className="font-display text-6xl font-extrabold leading-[0.95] tracking-tight text-foreground sm:text-7xl">
            Vaarta
          </p>
          <LoadingBlock
            label="Preparing your sign-in…"
            detail="Bringing your learning world online."
            className="mt-8"
          />
        </div>
      </div>

      <div className="flex h-[38vh] shrink-0 items-end bg-ink p-6 lg:min-h-dvh lg:basis-[58%] lg:shrink lg:p-10">
        <p className="font-display text-2xl font-extrabold text-white lg:text-3xl">
          Your next conversation is loading.
        </p>
      </div>
    </div>
  );
}

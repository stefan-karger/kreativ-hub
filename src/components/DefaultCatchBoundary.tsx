import type { ErrorComponentProps } from "@tanstack/solid-router"
import { ErrorComponent, Link, rootRouteId, useMatch, useRouter } from "@tanstack/solid-router"

export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
  const router = useRouter()
  const isRoot = useMatch({
    strict: false,
    select: (state) => state.id === rootRouteId
  })

  console.error(error)

  return (
    <div class="flex min-w-0 flex-1 flex-col items-center justify-center gap-6 p-4">
      <ErrorComponent error={error} />
      <div class="flex flex-wrap items-center gap-2">
        <button
          class="cursor-pointer rounded-sm bg-gray-600 px-2 py-1 font-extrabold text-white uppercase dark:bg-gray-700"
          onClick={() => {
            router.invalidate()
          }}
          type="button"
        >
          Try Again
        </button>
        {isRoot() ? (
          <Link
            class="rounded-sm bg-gray-600 px-2 py-1 font-extrabold text-white uppercase dark:bg-gray-700"
            to="/"
          >
            Home
          </Link>
        ) : (
          <Link
            class="rounded-sm bg-gray-600 px-2 py-1 font-extrabold text-white uppercase dark:bg-gray-700"
            onClick={(e) => {
              e.preventDefault()
              window.history.back()
            }}
            to="/"
          >
            Go Back
          </Link>
        )}
      </div>
    </div>
  )
}

import type { ParentProps } from "solid-js"

import { Link } from "@tanstack/solid-router"

export function NotFound(props: ParentProps) {
  return (
    <div class="space-y-2 p-2">
      <div class="text-gray-600 dark:text-gray-400">
        {props.children || <p>The page you are looking for does not exist.</p>}
      </div>
      <p class="flex flex-wrap items-center gap-2">
        <button
          class="rounded-sm bg-emerald-500 px-2 py-1 font-black text-sm text-white uppercase"
          onClick={() => window.history.back()}
          type="button"
        >
          Go back
        </button>
        <Link
          class="rounded-sm bg-cyan-600 px-2 py-1 font-black text-sm text-white uppercase"
          to="/"
        >
          Start Over
        </Link>
      </p>
    </div>
  )
}

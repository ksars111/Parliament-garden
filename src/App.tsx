/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';

// Lazy load the heavy Map component
// Since it's a named export, we handle the import manually
const GardenMap = lazy(() => 
  import('./components/Map').then(module => ({ default: module.GardenMap }))
);

export default function App() {
  return (
    <ErrorBoundary>
      <main className="w-full h-screen overflow-hidden bg-gray-950">
        <Suspense fallback={
          <div className="flex flex-col items-center justify-center w-full h-full bg-gray-950 text-white gap-4">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-2 border-emerald-500/20"></div>
              <div className="absolute inset-0 rounded-full border-t-2 border-emerald-500 animate-spin"></div>
            </div>
            <div className="flex flex-col items-center gap-1">
              <h1 className="text-xl font-medium tracking-tight text-emerald-500">Initializing Map</h1>
              <p className="text-sm text-gray-500 font-mono uppercase tracking-widest animate-pulse">Loading Assets...</p>
            </div>
            {/* Minimal attribution for technical design feel */}
            <div className="absolute bottom-12 text-[10px] text-gray-700 font-mono uppercase tracking-[0.2em]">
              Parliament Garden Explorer / Build 1.2
            </div>
          </div>
        }>
          <GardenMap />
        </Suspense>
      </main>
    </ErrorBoundary>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GardenMap } from './components/Map';
import { ErrorBoundary } from './components/ErrorBoundary';

export default function App() {
  return (
    <ErrorBoundary>
      <main className="w-full h-screen overflow-hidden bg-gray-950">
        <GardenMap />
      </main>
    </ErrorBoundary>
  );
}
 
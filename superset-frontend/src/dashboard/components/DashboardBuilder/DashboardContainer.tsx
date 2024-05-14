/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
// ParentSize uses resize observer so the dashboard will update size
// when its container size changes, due to e.g., builder side panel opening
import React, { FC, useEffect, useMemo, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Filter,
  Filters,
  LabelsColorMapSource,
  getLabelsColorMap,
} from '@superset-ui/core';
import { ParentSize } from '@visx/responsive';
import { pick } from 'lodash';
import Tabs from 'src/components/Tabs';
import DashboardGrid from 'src/dashboard/containers/DashboardGrid';
import {
  DashboardInfo,
  DashboardLayout,
  LayoutItem,
  RootState,
} from 'src/dashboard/types';
import {
  DASHBOARD_GRID_ID,
  DASHBOARD_ROOT_DEPTH,
} from 'src/dashboard/util/constants';
import { getChartIdsInFilterScope } from 'src/dashboard/util/getChartIdsInFilterScope';
import findTabIndexByComponentId from 'src/dashboard/util/findTabIndexByComponentId';
import { setInScopeStatusOfFilters } from 'src/dashboard/actions/nativeFilters';
import { updateDashboardLabelsColor } from 'src/dashboard/actions/dashboardState';
import {
  applyColors,
  getColorNamespace,
  resetColors,
} from 'src/utils/colorScheme';
import { NATIVE_FILTER_DIVIDER_PREFIX } from '../nativeFilters/FiltersConfigModal/utils';
import { findTabsWithChartsInScope } from '../nativeFilters/utils';
import { getRootLevelTabsComponent } from './utils';

type DashboardContainerProps = {
  topLevelTabs?: LayoutItem;
};

const useNativeFilterScopes = () => {
  const nativeFilters = useSelector<RootState, Filters>(
    state => state.nativeFilters?.filters,
  );
  return useMemo(
    () =>
      nativeFilters
        ? Object.values(nativeFilters).map((filter: Filter) =>
            pick(filter, ['id', 'scope', 'type']),
          )
        : [],
    [JSON.stringify(nativeFilters)],
  );
};

const DashboardContainer: FC<DashboardContainerProps> = ({ topLevelTabs }) => {
  const nativeFilterScopes = useNativeFilterScopes();
  const dispatch = useDispatch();

  const dashboardLayout = useSelector<RootState, DashboardLayout>(
    state => state.dashboardLayout.present,
  );
  const dashboardInfo = useSelector<RootState, DashboardInfo>(
    state => state.dashboardInfo,
  );
  const directPathToChild = useSelector<RootState, string[]>(
    state => state.dashboardState.directPathToChild,
  );
  const chartIds = useSelector<RootState, number[]>(state =>
    Object.values(state.charts).map(chart => chart.id),
  );

  const prevTabIndexRef = useRef();
  const tabIndex = useMemo(() => {
    const nextTabIndex = findTabIndexByComponentId({
      currentComponent: getRootLevelTabsComponent(dashboardLayout),
      directPathToChild,
    });

    if (nextTabIndex === -1) {
      return prevTabIndexRef.current ?? 0;
    }
    prevTabIndexRef.current = nextTabIndex;
    return nextTabIndex;
  }, [dashboardLayout, directPathToChild]);

  useEffect(() => {
    if (nativeFilterScopes.length === 0) {
      return;
    }
    const scopes = nativeFilterScopes.map(filterScope => {
      if (filterScope.id.startsWith(NATIVE_FILTER_DIVIDER_PREFIX)) {
        return {
          filterId: filterScope.id,
          tabsInScope: [],
          chartsInScope: [],
        };
      }
      const chartsInScope: number[] = getChartIdsInFilterScope(
        filterScope.scope,
        chartIds,
        dashboardLayout,
      );
      const tabsInScope = findTabsWithChartsInScope(
        dashboardLayout,
        chartsInScope,
      );
      return {
        filterId: filterScope.id,
        tabsInScope: Array.from(tabsInScope),
        chartsInScope,
      };
    });
    dispatch(setInScopeStatusOfFilters(scopes));
  }, [nativeFilterScopes, dashboardLayout, dispatch]);

  const childIds: string[] = topLevelTabs
    ? topLevelTabs.children
    : [DASHBOARD_GRID_ID];
  const min = Math.min(tabIndex, childIds.length - 1);
  const activeKey = min === 0 ? DASHBOARD_GRID_ID : min.toString();
  const TOP_OF_PAGE_RANGE = 220;

  useEffect(() => {
    // verify freshness of color map on tab change
    // and when loading for first time
    setTimeout(() => {
      dispatch(updateDashboardLabelsColor());
    }, 500);
  }, [directPathToChild, dispatch]);

  useEffect(() => {
    const labelsColorMap = getLabelsColorMap();
    const colorNamespace = getColorNamespace(
      dashboardInfo?.metadata?.color_namespace,
    );
    labelsColorMap.source = LabelsColorMapSource.Dashboard;
    // apply labels color as dictated by stored metadata
    applyColors(dashboardInfo.metadata);

    return () => {
      resetColors(getColorNamespace(colorNamespace));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardInfo.id, dispatch]);

  return (
    <div className="grid-container" data-test="grid-container">
      <ParentSize>
        {({ width }) => (
          /*
            We use a TabContainer irrespective of whether top-level tabs exist to maintain
            a consistent React component tree. This avoids expensive mounts/unmounts of
            the entire dashboard upon adding/removing top-level tabs, which would otherwise
            happen because of React's diffing algorithm
          */
          <Tabs
            id={DASHBOARD_GRID_ID}
            activeKey={activeKey}
            renderTabBar={() => <></>}
            fullWidth={false}
            animated={false}
            allowOverflow
            onFocus={e => {
              if (
                // prevent scrolling when tabbing to the tab pane
                e.target.classList.contains('ant-tabs-tabpane') &&
                window.scrollY < TOP_OF_PAGE_RANGE
              ) {
                // prevent window from jumping down when tabbing
                // if already at the top of the page
                // to help with accessibility when using keyboard navigation
                window.scrollTo(window.scrollX, 0);
              }
            }}
          >
            {childIds.map((id, index) => (
              // Matching the key of the first TabPane irrespective of topLevelTabs
              // lets us keep the same React component tree when !!topLevelTabs changes.
              // This avoids expensive mounts/unmounts of the entire dashboard.
              <Tabs.TabPane
                key={index === 0 ? DASHBOARD_GRID_ID : index.toString()}
              >
                <DashboardGrid
                  gridComponent={dashboardLayout[id]}
                  // see isValidChild for why tabs do not increment the depth of their children
                  depth={DASHBOARD_ROOT_DEPTH + 1} // (topLevelTabs ? 0 : 1)}
                  width={width}
                  isComponentVisible={index === tabIndex}
                />
              </Tabs.TabPane>
            ))}
          </Tabs>
        )}
      </ParentSize>
    </div>
  );
};

export default DashboardContainer;

// Declarative PostHog dashboard definition for Flight3d (events: src/analytics/posthog.js).
export const DASHBOARD_NAME = 'Flight3d Overview';

const ev = (event, extra = {}) => ({ kind: 'EventsNode', event, name: event, math: 'total', ...extra });
const trends = (series, { breakdown, display = 'ActionsLineGraph', interval = 'day', dateFrom = '-30d' } = {}) => ({
  kind: 'InsightVizNode',
  source: {
    kind: 'TrendsQuery',
    series,
    interval,
    dateRange: { date_from: dateFrom },
    trendsFilter: { display },
    ...(breakdown && {
      breakdownFilter: Array.isArray(breakdown)
        ? { breakdowns: breakdown.map(property => ({ property, type: 'event' })) }
        : { breakdown, breakdown_type: 'event' },
    }),
  },
});
const avg = (event, property) => ev(event, { math: 'avg', math_property: property });

export const INSIGHTS = [
  ['Flights started per day', trends([ev('flight_started')])],
  ['Flight outcomes (ended vs crashed)', trends([ev('flight_ended'), ev('flight_crashed')])],
  ['Start → end funnel', {
    kind: 'InsightVizNode',
    source: {
      kind: 'FunnelsQuery',
      series: [ev('flight_started'), ev('flight_ended')].map(({ math, ...n }) => n),
      dateRange: { date_from: '-30d' },
      funnelsFilter: { funnelWindowInterval: 1, funnelWindowIntervalUnit: 'hour' },
    },
  }],
  ['Flights by aircraft', trends([ev('flight_started')], { breakdown: 'aircraft', display: 'ActionsBarValue' })],
  ['Flights by scenario', trends([ev('flight_started')], { breakdown: 'scenario', display: 'ActionsBarValue' })],
  ['Players by country (world map)', trends([ev('flight_started', { math: 'dau' })], { breakdown: '$geoip_country_code', display: 'WorldMap' })],
  ['Players by region and city', trends([ev('flight_started', { math: 'dau' })], { breakdown: ['$geoip_subdivision_1_name', '$geoip_city_name'], display: 'ActionsTable' })],
  ['Flights by airport', trends([ev('flight_started')], { breakdown: 'airport', display: 'ActionsBarValue' })],
  ['Pilot mode (human vs AI)', trends([ev('pilot_mode_selected')], { breakdown: 'pilotMode', display: 'ActionsPie' })],
  ['Crash types', trends([ev('flight_crashed')], { breakdown: 'crashType', display: 'ActionsBarValue' })],
  ['Crashes by aircraft', trends([ev('flight_crashed')], { breakdown: 'aircraft', display: 'ActionsBarValue' })],
  ['Average flight duration (s)', trends([avg('flight_ended', 'durationSeconds')])],
  ['Average score', trends([avg('flight_ended', 'score')], { breakdown: 'scenario', display: 'ActionsBarValue' })],
  ['Startup time (ms)', trends([avg('startup_trace', 'firstVisibleMs'), avg('startup_trace', 'ready')])],
  ['User feedback submitted', trends([ev('user_feedback_submitted')])],
  ['JS exceptions', trends([ev('$exception')])],
];

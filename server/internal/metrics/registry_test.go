package metrics

import "testing"

func TestRegistryExcludesDatabaseSampledMetrics(t *testing.T) {
	registry := NewRegistry(RegistryOptions{})
	families, err := registry.Gatherer.Gather()
	if err != nil {
		t.Fatalf("gather metrics: %v", err)
	}

	retired := map[string]struct{}{
		"lumen_agent_task_queued":                               {},
		"lumen_agent_task_running":                              {},
		"lumen_agent_task_stuck_total":                          {},
		"lumen_business_sampler_query_errors_total":             {},
		"lumen_business_sampler_query_seconds":                  {},
		"lumen_workspace_total":                                 {},
		"lumen_seat_capacity_outbox_pending":                    {},
		"lumen_seat_capacity_outbox_dead_lettered":              {},
		"lumen_seat_capacity_outbox_oldest_pending_age_seconds": {},
		"lumen_channel_media_pending_objects":                   {},
		"lumen_channel_media_tombstoned_objects":                {},
		"lumen_runtime_gc_blocked_observation_failed_total":     {},
		"lumen_runtime_gc_blocked_runtimes":                     {},
		"lumen_runtime_gc_backlog_runtimes":                     {},
	}
	for _, family := range families {
		if _, found := retired[family.GetName()]; found {
			t.Errorf("retired database-sampled metric %q is still registered", family.GetName())
		}
	}
}

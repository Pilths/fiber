"""baseline: whole schema in one step (squashed from migrations 0001-0014 on 2 Nov 2026)

Revision ID: 0001
Revises:
"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = r"""
CREATE FUNCTION public.forbid_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;


SET default_tablespace = '';


--
-- Name: assign_cores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assign_cores (
    event_id bigint NOT NULL,
    core_id bigint NOT NULL
);


--
-- Name: core_holds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.core_holds (
    core_id bigint NOT NULL,
    reservation_id bigint NOT NULL
);


--
-- Name: cores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cores (
    id bigint NOT NULL,
    segment_id bigint NOT NULL,
    number integer NOT NULL,
    port_a_id bigint,
    port_b_id bigint,
    circuit_id text,
    in_use boolean DEFAULT false NOT NULL
);


--
-- Name: reservation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservation_events (
    id bigint NOT NULL,
    reservation_id bigint NOT NULL,
    type text NOT NULL,
    user_id bigint NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_id bigint,
    planned_date date,
    CONSTRAINT reservation_events_corrected_ck CHECK (((type <> 'corrected'::text) OR (((customer_id IS NOT NULL) OR (planned_date IS NOT NULL)) AND (length(TRIM(BOTH FROM COALESCE(reason, ''::text))) > 0)))),
    CONSTRAINT reservation_events_correction_ck CHECK (((type = 'corrected'::text) OR ((customer_id IS NULL) AND (planned_date IS NULL)))),
    CONSTRAINT reservation_events_type_ck CHECK ((type = ANY (ARRAY['requested'::text, 'approved'::text, 'rejected'::text, 'withdrawn'::text, 'kept'::text, 'release_requested'::text, 'released'::text, 'release_declined'::text, 'corrected'::text, 'assigned'::text])))
);


--
-- Name: core_status_v; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.core_status_v AS
 SELECT c.id AS core_id,
        CASE
            WHEN c.in_use THEN 'In use'::text
            WHEN (hold.last_event = ANY (ARRAY['approved'::text, 'kept'::text, 'release_requested'::text, 'release_declined'::text, 'corrected'::text, 'released'::text, 'assigned'::text])) THEN 'Reserved'::text
            WHEN (hold.last_event = 'requested'::text) THEN 'Requested'::text
            ELSE 'Available'::text
        END AS status
   FROM (public.cores c
     LEFT JOIN LATERAL ( SELECT ( SELECT re.type
                   FROM public.reservation_events re
                  WHERE (re.reservation_id = h.reservation_id)
                  ORDER BY re.created_at DESC, re.id DESC
                 LIMIT 1) AS last_event
           FROM public.core_holds h
          WHERE (h.core_id = c.id)) hold ON (true));


--
-- Name: cores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.cores ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.cores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id bigint NOT NULL,
    name text NOT NULL,
    created_by bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.customers ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.customers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: data_edits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_edits (
    id bigint NOT NULL,
    entity text NOT NULL,
    entity_id bigint NOT NULL,
    field text NOT NULL,
    old_value text,
    new_value text,
    reason text NOT NULL,
    user_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT data_edits_reason_ck CHECK ((length(TRIM(BOTH FROM reason)) > 0))
);


--
-- Name: data_edits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.data_edits ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.data_edits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: job_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_runs (
    job_name text NOT NULL,
    run_date date NOT NULL,
    ran_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: measurements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurements (
    id bigint NOT NULL,
    segment_id bigint NOT NULL,
    loss_db numeric(8,3) NOT NULL,
    tested_on date,
    upload_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    test_method text,
    field_team text,
    core_id bigint
);


--
-- Name: measurements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.measurements ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.measurements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ports (
    id bigint NOT NULL,
    port_id text NOT NULL,
    site_id bigint NOT NULL
);


--
-- Name: ports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ports ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: release_cores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.release_cores (
    event_id bigint NOT NULL,
    core_id bigint NOT NULL
);


--
-- Name: reservation_cores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservation_cores (
    reservation_id bigint NOT NULL,
    core_id bigint NOT NULL
);


--
-- Name: reservation_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.reservation_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.reservation_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservations (
    id bigint NOT NULL,
    customer_id bigint NOT NULL,
    planner_id bigint NOT NULL,
    planned_date date,
    is_new_customer boolean DEFAULT false NOT NULL,
    imported boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    group_label text,
    additional boolean,
    cv_ready_date date,
    contractor text,
    remark text,
    port_info_raw text,
    monitoring_code text,
    fiber_monitored text,
    unassigned_cores integer DEFAULT 0 NOT NULL,
    unassigned_segment_id bigint,
    srf_id text,
    CONSTRAINT reservations_fiber_monitored_ck CHECK ((fiber_monitored = ANY (ARRAY['Y'::text, 'N'::text, 'WIP'::text]))),
    CONSTRAINT reservations_unassigned_ck CHECK ((unassigned_cores >= 0)),
    CONSTRAINT reservations_unassigned_segment_ck CHECK (((unassigned_cores = 0) OR (unassigned_segment_id IS NOT NULL)))
);


--
-- Name: reservation_state_v; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.reservation_state_v AS
 SELECT reservation_id,
    status,
    last_event,
    last_event_at,
    last_reason,
    stale_since,
    ((status = 'approved'::text) AND (last_event <> 'release_requested'::text) AND (((stale_since + '3 mons'::interval))::date < ((now() AT TIME ZONE 'Asia/Kuala_Lumpur'::text))::date)) AS is_stale
   FROM ( SELECT r.id AS reservation_id,
                CASE
                    WHEN (ap.at IS NOT NULL) THEN
                    CASE
                        WHEN ((rel.n > 0) AND (NOT (EXISTS ( SELECT 1
                           FROM public.core_holds h
                          WHERE (h.reservation_id = r.id))))) THEN 'ended'::text
                        ELSE 'approved'::text
                    END
                    WHEN (le.type = 'rejected'::text) THEN 'rejected'::text
                    WHEN (le.type = 'withdrawn'::text) THEN 'withdrawn'::text
                    ELSE 'pending'::text
                END AS status,
            le.type AS last_event,
            le.created_at AS last_event_at,
                CASE
                    WHEN (le.type = ANY (ARRAY['rejected'::text, 'release_declined'::text])) THEN le.reason
                    ELSE NULL::text
                END AS last_reason,
            GREATEST(
                CASE
                    WHEN (r.imported AND (r.planned_date IS NOT NULL)) THEN r.planned_date
                    ELSE ((ap.at AT TIME ZONE 'Asia/Kuala_Lumpur'::text))::date
                END, ((kp.at AT TIME ZONE 'Asia/Kuala_Lumpur'::text))::date) AS stale_since
           FROM ((((public.reservations r
             LEFT JOIN LATERAL ( SELECT e.type,
                    e.reason,
                    e.created_at
                   FROM public.reservation_events e
                  WHERE (e.reservation_id = r.id)
                  ORDER BY e.created_at DESC, e.id DESC
                 LIMIT 1) le ON (true))
             LEFT JOIN LATERAL ( SELECT min(e.created_at) AS at
                   FROM public.reservation_events e
                  WHERE ((e.reservation_id = r.id) AND (e.type = 'approved'::text))) ap ON (true))
             LEFT JOIN LATERAL ( SELECT max(e.created_at) AS at
                   FROM public.reservation_events e
                  WHERE ((e.reservation_id = r.id) AND (e.type = 'kept'::text))) kp ON (true))
             LEFT JOIN LATERAL ( SELECT count(*) AS n
                   FROM public.reservation_events e
                  WHERE ((e.reservation_id = r.id) AND (e.type = 'released'::text))) rel ON (true))) t;


--
-- Name: reservation_unassigned_v; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.reservation_unassigned_v AS
 SELECT r.id AS reservation_id,
    r.unassigned_segment_id AS segment_id,
        CASE
            WHEN (st.status = ANY (ARRAY['pending'::text, 'approved'::text])) THEN GREATEST((r.unassigned_cores - ( SELECT count(*) AS count
               FROM public.reservation_cores rc
              WHERE (rc.reservation_id = r.id))), (0)::bigint)
            ELSE (0)::bigint
        END AS remaining
   FROM (public.reservations r
     JOIN public.reservation_state_v st ON ((st.reservation_id = r.id)))
  WHERE (r.unassigned_cores > 0);


--
-- Name: reservations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.reservations ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.reservations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: route_segments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.route_segments (
    route_id bigint NOT NULL,
    segment_id bigint NOT NULL,
    "position" integer NOT NULL
);


--
-- Name: routes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routes (
    id bigint NOT NULL,
    site_a_id bigint NOT NULL,
    site_b_id bigint NOT NULL,
    geom public.geometry(LineString,4326),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT routes_sites_differ_ck CHECK ((site_a_id <> site_b_id))
);


--
-- Name: routes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.routes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.routes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: segments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.segments (
    id bigint NOT NULL,
    site_a_id bigint NOT NULL,
    site_b_id bigint NOT NULL,
    route_type text,
    region text,
    distance_km numeric(10,3),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    survey_cores integer,
    cable_size integer DEFAULT 144 NOT NULL,
    route text,
    section text,
    fiber_cut boolean DEFAULT false NOT NULL,
    CONSTRAINT segments_cable_size_ck CHECK ((cable_size > 0)),
    CONSTRAINT segments_distance_ck CHECK ((distance_km >= (0)::numeric)),
    CONSTRAINT segments_region_ck CHECK ((region = ANY (ARRAY['North'::text, 'Central'::text, 'South'::text, 'East Coast'::text]))),
    CONSTRAINT segments_route_type_ck CHECK ((route_type = ANY (ARRAY['Trunk'::text, 'Metro'::text]))),
    CONSTRAINT segments_sites_differ_ck CHECK ((site_a_id <> site_b_id))
);


--
-- Name: segments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.segments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.segments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id text NOT NULL,
    user_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: sites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sites (
    id bigint NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    geom public.geometry(Point,4326),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    details jsonb,
    lrd_site_id bigint,
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT sites_kind_ck CHECK ((kind = ANY (ARRAY['site'::text, 'building'::text, 'equipment'::text, 'data_center'::text, 'toc'::text])))
);


--
-- Name: sites_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.sites ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sites_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: upload_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.upload_rows (
    id bigint NOT NULL,
    upload_id bigint NOT NULL,
    row_group text NOT NULL,
    entity text NOT NULL,
    payload jsonb NOT NULL,
    warnings jsonb,
    sheet text,
    row_number integer,
    reason text,
    raw jsonb,
    status text,
    CONSTRAINT upload_rows_group_ck CHECK ((row_group = ANY (ARRAY['new'::text, 'changed'::text, 'conflict'::text, 'missing'::text, 'rejected'::text, 'needs_review'::text, 'unchanged'::text]))),
    CONSTRAINT upload_rows_status_ck CHECK ((status = ANY (ARRAY['ready'::text, 'needs_review'::text, 'rejected'::text])))
);


--
-- Name: upload_rows_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.upload_rows ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.upload_rows_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uploads (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    filename text NOT NULL,
    kind text NOT NULL,
    status text DEFAULT 'staged'::text NOT NULL,
    summary jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    confirmed_at timestamp with time zone,
    CONSTRAINT uploads_kind_ck CHECK ((kind = ANY (ARRAY['excel'::text, 'kmz'::text, 'site_master'::text, 'segment_list'::text]))),
    CONSTRAINT uploads_status_ck CHECK ((status = ANY (ARRAY['staged'::text, 'confirmed'::text, 'discarded'::text])))
);


--
-- Name: uploads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.uploads ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.uploads_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    username text NOT NULL,
    display_name text NOT NULL,
    role text NOT NULL,
    password_hash text,
    must_change_password boolean DEFAULT true NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_role_ck CHECK ((role = ANY (ARRAY['planner'::text, 'admin'::text])))
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: assign_cores assign_cores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assign_cores
    ADD CONSTRAINT assign_cores_pkey PRIMARY KEY (event_id, core_id);


--
-- Name: core_holds core_holds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.core_holds
    ADD CONSTRAINT core_holds_pkey PRIMARY KEY (core_id);


--
-- Name: cores cores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cores
    ADD CONSTRAINT cores_pkey PRIMARY KEY (id);


--
-- Name: cores cores_segment_id_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cores
    ADD CONSTRAINT cores_segment_id_number_key UNIQUE (segment_id, number);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: data_edits data_edits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_edits
    ADD CONSTRAINT data_edits_pkey PRIMARY KEY (id);


--
-- Name: job_runs job_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_pkey PRIMARY KEY (job_name, run_date);


--
-- Name: measurements measurements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurements
    ADD CONSTRAINT measurements_pkey PRIMARY KEY (id);


--
-- Name: ports ports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ports
    ADD CONSTRAINT ports_pkey PRIMARY KEY (id);


--
-- Name: ports ports_port_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ports
    ADD CONSTRAINT ports_port_id_key UNIQUE (port_id);


--
-- Name: release_cores release_cores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_cores
    ADD CONSTRAINT release_cores_pkey PRIMARY KEY (event_id, core_id);


--
-- Name: reservation_cores reservation_cores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_cores
    ADD CONSTRAINT reservation_cores_pkey PRIMARY KEY (reservation_id, core_id);


--
-- Name: reservation_events reservation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_events
    ADD CONSTRAINT reservation_events_pkey PRIMARY KEY (id);


--
-- Name: reservations reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_pkey PRIMARY KEY (id);


--
-- Name: route_segments route_routes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_segments
    ADD CONSTRAINT route_routes_pkey PRIMARY KEY (route_id, segment_id);


--
-- Name: route_segments route_routes_route_id_position_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_segments
    ADD CONSTRAINT route_routes_route_id_position_key UNIQUE (route_id, "position");


--
-- Name: routes routes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_pkey PRIMARY KEY (id);


--
-- Name: segments segments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.segments
    ADD CONSTRAINT segments_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sites sites_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_name_key UNIQUE (name);


--
-- Name: sites sites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_pkey PRIMARY KEY (id);


--
-- Name: upload_rows upload_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_rows
    ADD CONSTRAINT upload_rows_pkey PRIMARY KEY (id);


--
-- Name: uploads uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT uploads_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: customers_name_lower_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customers_name_lower_uq ON public.customers USING btree (lower(name));


--
-- Name: data_edits_entity_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX data_edits_entity_ix ON public.data_edits USING btree (entity, entity_id, field, created_at);


--
-- Name: measurements_core_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX measurements_core_ix ON public.measurements USING btree (core_id);


--
-- Name: measurements_segment_created_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX measurements_segment_created_ix ON public.measurements USING btree (segment_id, created_at);


--
-- Name: reservation_events_res_created_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservation_events_res_created_ix ON public.reservation_events USING btree (reservation_id, created_at);


--
-- Name: routes_site_pair_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX routes_site_pair_ix ON public.routes USING btree (LEAST(site_a_id, site_b_id), GREATEST(site_a_id, site_b_id));


--
-- Name: segments_site_pair_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX segments_site_pair_uq ON public.segments USING btree (LEAST(site_a_id, site_b_id), GREATEST(site_a_id, site_b_id));


--
-- Name: sessions_user_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_ix ON public.sessions USING btree (user_id);


--
-- Name: sites_geom_gix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sites_geom_gix ON public.sites USING gist (geom);


--
-- Name: sites_name_trgm_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sites_name_trgm_ix ON public.sites USING gin (name public.gin_trgm_ops);


--
-- Name: assign_cores assign_cores_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER assign_cores_append_only BEFORE DELETE OR UPDATE ON public.assign_cores FOR EACH ROW EXECUTE FUNCTION public.forbid_change();


--
-- Name: data_edits data_edits_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER data_edits_append_only BEFORE DELETE OR UPDATE ON public.data_edits FOR EACH ROW EXECUTE FUNCTION public.forbid_change();


--
-- Name: measurements measurements_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER measurements_append_only BEFORE DELETE OR UPDATE ON public.measurements FOR EACH ROW EXECUTE FUNCTION public.forbid_change();


--
-- Name: release_cores release_cores_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER release_cores_append_only BEFORE DELETE OR UPDATE ON public.release_cores FOR EACH ROW EXECUTE FUNCTION public.forbid_change();


--
-- Name: reservation_cores reservation_cores_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER reservation_cores_append_only BEFORE DELETE OR UPDATE ON public.reservation_cores FOR EACH ROW EXECUTE FUNCTION public.forbid_change();


--
-- Name: reservation_events reservation_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER reservation_events_append_only BEFORE DELETE OR UPDATE ON public.reservation_events FOR EACH ROW EXECUTE FUNCTION public.forbid_change();


--
-- Name: reservations reservations_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER reservations_append_only BEFORE DELETE OR UPDATE ON public.reservations FOR EACH ROW EXECUTE FUNCTION public.forbid_change();


--
-- Name: assign_cores assign_cores_core_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assign_cores
    ADD CONSTRAINT assign_cores_core_id_fkey FOREIGN KEY (core_id) REFERENCES public.cores(id);


--
-- Name: assign_cores assign_cores_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assign_cores
    ADD CONSTRAINT assign_cores_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.reservation_events(id);


--
-- Name: core_holds core_holds_core_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.core_holds
    ADD CONSTRAINT core_holds_core_id_fkey FOREIGN KEY (core_id) REFERENCES public.cores(id);


--
-- Name: core_holds core_holds_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.core_holds
    ADD CONSTRAINT core_holds_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservations(id);


--
-- Name: cores cores_port_a_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cores
    ADD CONSTRAINT cores_port_a_id_fkey FOREIGN KEY (port_a_id) REFERENCES public.ports(id);


--
-- Name: cores cores_port_b_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cores
    ADD CONSTRAINT cores_port_b_id_fkey FOREIGN KEY (port_b_id) REFERENCES public.ports(id);


--
-- Name: cores cores_segment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cores
    ADD CONSTRAINT cores_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES public.segments(id);


--
-- Name: customers customers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: data_edits data_edits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_edits
    ADD CONSTRAINT data_edits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: measurements measurements_core_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurements
    ADD CONSTRAINT measurements_core_id_fkey FOREIGN KEY (core_id) REFERENCES public.cores(id);


--
-- Name: measurements measurements_segment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurements
    ADD CONSTRAINT measurements_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES public.segments(id);


--
-- Name: measurements measurements_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurements
    ADD CONSTRAINT measurements_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.uploads(id);


--
-- Name: ports ports_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ports
    ADD CONSTRAINT ports_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id);


--
-- Name: release_cores release_cores_core_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_cores
    ADD CONSTRAINT release_cores_core_id_fkey FOREIGN KEY (core_id) REFERENCES public.cores(id);


--
-- Name: release_cores release_cores_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_cores
    ADD CONSTRAINT release_cores_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.reservation_events(id);


--
-- Name: reservation_cores reservation_cores_core_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_cores
    ADD CONSTRAINT reservation_cores_core_id_fkey FOREIGN KEY (core_id) REFERENCES public.cores(id);


--
-- Name: reservation_cores reservation_cores_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_cores
    ADD CONSTRAINT reservation_cores_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservations(id);


--
-- Name: reservation_events reservation_events_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_events
    ADD CONSTRAINT reservation_events_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: reservation_events reservation_events_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_events
    ADD CONSTRAINT reservation_events_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservations(id);


--
-- Name: reservation_events reservation_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservation_events
    ADD CONSTRAINT reservation_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: reservations reservations_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: reservations reservations_planner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_planner_id_fkey FOREIGN KEY (planner_id) REFERENCES public.users(id);


--
-- Name: reservations reservations_unassigned_segment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_unassigned_segment_id_fkey FOREIGN KEY (unassigned_segment_id) REFERENCES public.segments(id);


--
-- Name: route_segments route_segments_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_segments
    ADD CONSTRAINT route_segments_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id);


--
-- Name: route_segments route_segments_segment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_segments
    ADD CONSTRAINT route_segments_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES public.segments(id);


--
-- Name: routes routes_site_a_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_site_a_id_fkey FOREIGN KEY (site_a_id) REFERENCES public.sites(id);


--
-- Name: routes routes_site_b_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_site_b_id_fkey FOREIGN KEY (site_b_id) REFERENCES public.sites(id);


--
-- Name: segments segments_site_a_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.segments
    ADD CONSTRAINT segments_site_a_id_fkey FOREIGN KEY (site_a_id) REFERENCES public.sites(id);


--
-- Name: segments segments_site_b_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.segments
    ADD CONSTRAINT segments_site_b_id_fkey FOREIGN KEY (site_b_id) REFERENCES public.sites(id);


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: sites sites_lrd_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_lrd_site_id_fkey FOREIGN KEY (lrd_site_id) REFERENCES public.sites(id);


--
-- Name: upload_rows upload_rows_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_rows
    ADD CONSTRAINT upload_rows_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.uploads(id);


--
-- Name: uploads uploads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT uploads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--
"""


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.get_bind().connection.driver_connection.execute(SCHEMA)  # raw psycopg: no % handling


def downgrade() -> None:
    raise NotImplementedError("the baseline cannot be downgraded; drop and recreate the database")

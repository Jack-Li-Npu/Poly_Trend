"""Cutoff-limited display data, kept separate from the full immutable replay inputs."""

from datetime import datetime

from .analytics import available_points, utc
from .models import EvidenceBundle


def availability_view(bundle: EvidenceBundle, cutoff: datetime) -> EvidenceBundle:
    view = bundle.model_copy(deep=True)
    cutoff = utc(cutoff)
    view.observations = [item for item in view.observations if utc(item.available_at) <= cutoff]
    known = {item.id for item in view.observations}
    metadata_available = utc(view.event.observed_at) <= cutoff
    if not metadata_available:
        for contract in view.event.contracts:
            contract.prices = []
        view.event.relations = []
        view.event.attention = None
        view.issues.append(
            "Event wording is retrospectively supplied metadata; it was not captured by this cutoff."
        )
    for market in view.markets:
        linked = bool(market.observation_ids) and all(
            key in known for key in market.observation_ids
        )
        market.history = available_points(market.history, cutoff) if linked else []
        if not linked or not metadata_available or utc(market.as_of) > cutoff:
            for key in (
                "probability",
                "bid",
                "ask",
                "spread",
                "bid_depth_usd",
                "ask_depth_usd",
                "tick_size",
                "fee_rate",
                "volume_24h_usd",
                "open_interest_usd",
                "open_interest_shares",
                "unique_participants",
                "top_holder_share",
                "trade_count",
                "taker_net_shares",
                "taker_net_notional_usd",
            ):
                setattr(market, key, None)
            market.quote_type = "unavailable"
            market.as_of = cutoff
            market.holder_coverage = None
            market.issues.append(
                "Quote and liquidity fields were unavailable at the selected cutoff."
            )
        market.observation_ids = [key for key in market.observation_ids if key in known]
    for asset in view.assets:
        linked = bool(asset.observation_ids) and all(key in known for key in asset.observation_ids)
        asset.points = available_points(asset.points, cutoff) if linked else []
        asset.observation_ids = [key for key in asset.observation_ids if key in known]
        if not linked:
            asset.issues.append("Source history had not been captured by the selected cutoff.")
    view.context = [
        item
        for item in view.context
        if utc(item.available_at) <= cutoff and all(key in known for key in item.observation_ids)
    ]
    view.issues.append(
        "Historical display contains only observations available at the cutoff; the full pinned input bundle is retained separately for audit and replay."
    )
    return view

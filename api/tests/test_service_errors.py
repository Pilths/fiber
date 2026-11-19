"""Services raise plain domain errors, so they can be called outside a request."""
import pytest
from app.errors import Invalid, NotFound, ServiceError
from app.reservations import service


def test_service_refuses_without_a_request(db):
    with pytest.raises(Invalid) as caught:
        service.correct(db, None, 1, "", None, None, [1])
    assert isinstance(caught.value, ServiceError)
    assert caught.value.status == 422


def test_service_not_found_without_a_request(db):
    with pytest.raises(NotFound) as caught:
        service.get(db, 999999999)
    assert (caught.value.status, caught.value.message) == (404, "Reservation not found")

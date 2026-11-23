"""A KMZ whose unpacked KML is over the cap is refused before anything is staged."""
import zipfile

import pytest
from app.ingest import kmz
from app.load_kmz import run
from sqlalchemy import text
from sqlalchemy.orm import Session
from test_auth import login, mkuser

URL = "/api/admin/kmz"
MESSAGE = "the KML inside is larger than 50 MB"


@pytest.fixture
def small_cap(monkeypatch):
    monkeypatch.setattr(kmz, "MAX_KML_BYTES", 1000)


def big_kmz(path, size=5000):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("doc.kml", b" " * size)  # packs small, unpacks big
    return path


def upload_count(db):
    return db.execute(text("SELECT count(*) FROM uploads")).scalar_one()


def test_web_refuses_a_big_kml_and_stages_nothing(client, db, small_cap, tmp_path):
    mkuser(db, "boss", "admin")
    assert login(client, "boss").status_code == 200
    data = big_kmz(tmp_path / "big.kmz").read_bytes()
    before = upload_count(db)
    for path in (f"{URL}/uploads", f"{URL}/folders"):
        response = client.post(path, files={"file": ("big.kmz", data)})
        assert response.status_code == 422
        assert MESSAGE in response.json()["detail"]
    assert upload_count(db) == before


def test_cli_refuses_a_big_kml(db, small_cap, tmp_path, capsys):
    mkuser(db, "admin1", "admin")
    path = str(big_kmz(tmp_path / "big.kmz"))
    before = upload_count(db)
    assert run(Session(bind=db), "admin1", path, "propose route") == 1
    assert MESSAGE in capsys.readouterr().out
    assert upload_count(db) == before


def test_a_header_that_lies_about_the_size_is_still_refused(small_cap, tmp_path, monkeypatch):
    path = big_kmz(tmp_path / "liar.kmz")
    real_getinfo = zipfile.ZipFile.getinfo
    calls = []

    def small_header(self, name):
        info = real_getinfo(self, name)
        if calls:
            return info  # opening the file reads the true header
        calls.append(name)
        lying = zipfile.ZipInfo(name)
        lying.file_size = 10
        return lying

    monkeypatch.setattr(zipfile.ZipFile, "getinfo", small_header)
    with pytest.raises(ValueError, match="larger than 50 MB"):
        kmz.read_kml_root(str(path))

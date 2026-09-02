package store_test

import "testing"

func TestViewCRUD(t *testing.T) {
	st := openTestStore(t)

	v, err := st.CreateView("Monday numbers", "flows", map[string]interface{}{
		"name":  "task.create",
		"group": "trait:role",
	})
	if err != nil {
		t.Fatal(err)
	}
	if v.ID == 0 || v.Name != "Monday numbers" || v.Params["group"] != "trait:role" {
		t.Fatalf("created view = %+v", v)
	}

	got, err := st.GetView(v.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.Params["name"] != "task.create" {
		t.Fatalf("round trip = %+v", got)
	}

	updated, err := st.UpdateView(v.ID, "Monday numbers (v2)", "flows",
		map[string]interface{}{"name": "report.export"})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != "Monday numbers (v2)" || updated.Params["name"] != "report.export" {
		t.Errorf("updated = %+v", updated)
	}
	if _, ok := updated.Params["group"]; ok {
		t.Error("update should replace params, not merge into them")
	}

	list, err := st.ListViews()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Errorf("list = %d views, want 1", len(list))
	}

	// Missing rows are absent, not errors.
	if missing, err := st.GetView(9999); err != nil || missing != nil {
		t.Errorf("GetView(9999) = %v, %v; want nil, nil", missing, err)
	}
	if v, err := st.UpdateView(9999, "x", "flows", nil); err != nil || v != nil {
		t.Errorf("UpdateView(9999) = %v, %v; want nil, nil", v, err)
	}

	ok, err := st.DeleteView(v.ID)
	if err != nil || !ok {
		t.Fatalf("DeleteView = %v, %v", ok, err)
	}
	if ok, _ := st.DeleteView(v.ID); ok {
		t.Error("deleting twice should report not-found the second time")
	}
}

func TestViewValidation(t *testing.T) {
	st := openTestStore(t)

	if _, err := st.CreateView("", "flows", nil); err == nil {
		t.Error("empty name should be rejected")
	}
	if _, err := st.CreateView("   ", "flows", nil); err == nil {
		t.Error("whitespace-only name should be rejected")
	}
	if _, err := st.CreateView("x", "sql", nil); err == nil {
		t.Error("an unknown kind should be rejected — the set is closed on purpose")
	}
	for _, kind := range []string{"flows", "funnel", "aggregates", "events"} {
		if _, err := st.CreateView("v-"+kind, kind, nil); err != nil {
			t.Errorf("kind %q should be accepted: %v", kind, err)
		}
	}

	// Nil params must round-trip as an empty object, never as null.
	v, err := st.CreateView("no params", "aggregates", nil)
	if err != nil {
		t.Fatal(err)
	}
	if v.Params == nil {
		t.Error("params should be an empty object, not nil")
	}
	got, _ := st.GetView(v.ID)
	if got.Params == nil {
		t.Error("params should read back as an empty object")
	}
}

// The acceptance criterion: deleting a view must not break a board that
// references it. The board loses a panel and keeps working.
func TestDeletingAViewDoesNotBreakItsBoard(t *testing.T) {
	st := openTestStore(t)

	a, _ := st.CreateView("flows", "flows", map[string]interface{}{"name": "task.create"})
	b, _ := st.CreateView("funnel", "funnel", map[string]interface{}{"steps": "view,cart"})
	c, _ := st.CreateView("aggregates", "aggregates", nil)

	board, err := st.CreateBoard("Monday", []int64{a.ID, b.ID, c.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(board.Views) != 3 {
		t.Fatalf("board has %d views, want 3", len(board.Views))
	}
	// Order is the order given, not insertion order by id.
	if board.Views[0].ID != a.ID || board.Views[2].ID != c.ID {
		t.Errorf("board order = %v", []int64{board.Views[0].ID, board.Views[1].ID, board.Views[2].ID})
	}

	if _, err := st.DeleteView(b.ID); err != nil {
		t.Fatal(err)
	}

	after, err := st.GetBoard(board.ID)
	if err != nil {
		t.Fatalf("board is unreadable after deleting one of its views: %v", err)
	}
	if after == nil {
		t.Fatal("board disappeared when a view it referenced was deleted")
	}
	if len(after.Views) != 2 {
		t.Fatalf("board has %d views, want 2 after one was deleted", len(after.Views))
	}
	for _, v := range after.Views {
		if v.ID == b.ID {
			t.Error("deleted view still on the board")
		}
	}
}

func TestBoardOrderingAndReplacement(t *testing.T) {
	st := openTestStore(t)

	a, _ := st.CreateView("a", "flows", nil)
	b, _ := st.CreateView("b", "flows", nil)
	c, _ := st.CreateView("c", "flows", nil)

	board, err := st.CreateBoard("Ops", []int64{c.ID, a.ID})
	if err != nil {
		t.Fatal(err)
	}
	if board.Views[0].ID != c.ID || board.Views[1].ID != a.ID {
		t.Errorf("board did not preserve the given order")
	}

	reordered, err := st.SetBoardViews(board.ID, []int64{a.ID, b.ID, c.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(reordered.Views) != 3 || reordered.Views[0].ID != a.ID || reordered.Views[2].ID != c.ID {
		t.Errorf("reordered board = %+v", reordered.Views)
	}

	// A duplicate in the list is a mistake, not a feature.
	deduped, err := st.SetBoardViews(board.ID, []int64{a.ID, a.ID, b.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(deduped.Views) != 2 {
		t.Errorf("duplicate view ids should collapse: got %d panels", len(deduped.Views))
	}

	if bd, err := st.SetBoardViews(9999, []int64{a.ID}); err != nil || bd != nil {
		t.Errorf("SetBoardViews on a missing board = %v, %v; want nil, nil", bd, err)
	}

	// Deleting a board leaves its views alone — they are independent objects.
	if ok, err := st.DeleteBoard(board.ID); err != nil || !ok {
		t.Fatalf("DeleteBoard = %v, %v", ok, err)
	}
	views, _ := st.ListViews()
	if len(views) != 3 {
		t.Errorf("deleting a board destroyed its views: %d remain, want 3", len(views))
	}
}

func TestListBoardsIncludesTheirViews(t *testing.T) {
	st := openTestStore(t)
	v, _ := st.CreateView("panel", "flows", map[string]interface{}{"name": "x"})
	if _, err := st.CreateBoard("One", []int64{v.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateBoard("Two", nil); err != nil {
		t.Fatal(err)
	}

	boards, err := st.ListBoards()
	if err != nil {
		t.Fatal(err)
	}
	if len(boards) != 2 {
		t.Fatalf("got %d boards, want 2", len(boards))
	}
	if len(boards[0].Views) != 1 || boards[0].Views[0].Params["name"] != "x" {
		t.Errorf("board views not hydrated: %+v", boards[0])
	}
	// An empty board serialises as an empty list, never null.
	if boards[1].Views == nil {
		t.Error("an empty board should have an empty views slice, not nil")
	}
}

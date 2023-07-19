"use client";

export const AddNewIssue = () => {
  const addNewIssue = () => {};

  return (
    <div id="addNewIssue" className="fixed bottom-4 right-4">
      <button onClick={addNewIssue} id="add" className="hover:opacity-80">
        <i className="fas fa-plus"></i>
      </button>
    </div>
  );
};

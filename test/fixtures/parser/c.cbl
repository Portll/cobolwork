       IDENTIFICATION DIVISION.
       PROGRAM-ID. WITC.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-R.
          COPY RECA REPLACING ==CP-A== BY ==XX-A==.
       01 WS-Z PIC X.
       PROCEDURE DIVISION.
       P1.
           MOVE XX-A TO WS-Z
           MOVE CP-B TO WS-Z.
           GOBACK.
